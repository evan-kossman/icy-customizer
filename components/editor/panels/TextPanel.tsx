"use client";

import { useEffect, useRef, useState } from "react";
import { Card, Button } from "../ui";
import type { TextObject } from "@/lib/design";
import type { EditorFont } from "@/lib/editor/types";

interface Props {
  fonts: EditorFont[];
  selected: TextObject | null;
  printDpi: number;
  onAdd: () => void;
  onChange: (patch: Partial<TextObject>) => void;
  onDelete: () => void;
  /** All text objects currently on the canvas */
  textObjects?: TextObject[];
}

const TEXT_OPTION_1 = { label: "TEXT OPTION 1", maxChars: 20 };
const TEXT_OPTION_2 = { label: "TEXT OPTION 2", maxChars: 30 };

function optionFor(index: number) {
  return index === 0 ? TEXT_OPTION_1 : TEXT_OPTION_2;
}

/** Deduplicate fonts by base family name.
 *  Fonts that differ only in weight/style (Bold, Italic, etc.) are collapsed
 *  into a single entry — bold/italic are driven by the style toggles below. */
function dedupFonts(fonts: EditorFont[]): EditorFont[] {
  const seen = new Set<string>();
  const result: EditorFont[] = [];
  for (const f of fonts) {
    const base = f.displayName
      .replace(/[\s-]*(bold|italic|oblique|light|thin|medium|semibold|black|heavy|regular|roman|demi|condensed|extended|narrow|wide|book)[\s-]*/gi, " ")
      .trim()
      .toLowerCase();
    if (!seen.has(base)) {
      seen.add(base);
      result.push(f);
    }
  }
  return result;
}

/** Preload a font into the browser so it renders in the dropdown. */
function ensureFontLoaded(font: EditorFont) {
  if (!font.url) return;
  const id = `font-face-${font.id}`;
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `@font-face { font-family: '${font.family}'; src: url('${font.url}'); font-display: swap; }`;
  document.head.appendChild(style);
}

/** Custom font picker dropdown — renders each font name in its own typeface. */
function FontPicker({
  fonts,
  value,
  onChange,
}: {
  fonts: EditorFont[];
  value: string;
  onChange: (family: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Inject @font-face rules for all fonts so the browser can render them in the list.
  useEffect(() => {
    fonts.forEach(ensureFontLoaded);
  }, [fonts]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  // Scroll selected item into view when list opens.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector("[data-selected='true']") as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [open]);

  const selected = fonts.find((f) => f.family === value) ?? fonts[0];

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-line bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span style={{ fontFamily: selected?.family }}>{selected?.displayName ?? value}</span>
        <i className={`fa-solid fa-chevron-${open ? "up" : "down"} ml-2 text-xs text-muted`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-label="Font"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-line bg-white shadow-lg"
        >
          {fonts.map((font) => {
            const isSelected = font.family === value;
            return (
              <div
                key={font.id}
                role="option"
                aria-selected={isSelected}
                data-selected={isSelected ? "true" : undefined}
                onMouseDown={() => {
                  onChange(font.family);
                  setOpen(false);
                }}
                className={`cursor-pointer px-3 py-2 text-sm transition-colors ${
                  isSelected
                    ? "bg-ink text-white"
                    : "hover:bg-canvas text-ink"
                }`}
                style={{ fontFamily: font.family }}
              >
                {font.displayName}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const ALIGN_ORDER = ["left", "center", "right"] as const;
type Align = (typeof ALIGN_ORDER)[number];

const ALIGN_ICONS: Record<Align, string> = {
  left: "fa-align-left",
  center: "fa-align-center",
  right: "fa-align-right",
};

export default function TextPanel({
  fonts,
  selected,
  printDpi: _printDpi,
  onAdd,
  onChange,
  onDelete,
  textObjects = [],
}: Props) {
  const selectedIndex = selected
    ? textObjects.findIndex((t) => t.id === selected.id)
    : -1;
  const option = selectedIndex >= 0 ? optionFor(selectedIndex) : null;
  const uniqueFonts = dedupFonts(fonts);

  function cycleAlign() {
    if (!selected) return;
    const cur = (selected.align ?? "left") as Align;
    const next = ALIGN_ORDER[(ALIGN_ORDER.indexOf(cur) + 1) % ALIGN_ORDER.length];
    onChange({ align: next });
  }

  return (
    <Card title="Add Your Text">
      <div className="space-y-3">
        {/* Slot 1 */}
        <TextSlot
          label={TEXT_OPTION_1.label}
          maxChars={TEXT_OPTION_1.maxChars}
          object={textObjects[0] ?? null}
          isSelected={selectedIndex === 0}
          onChange={onChange}
          onDelete={onDelete}
          onAdd={textObjects.length === 0 ? onAdd : undefined}
        />

        {/* Slot 2 — only show if slot 1 has text */}
        {textObjects.length >= 1 && (
          <TextSlot
            label={TEXT_OPTION_2.label}
            maxChars={TEXT_OPTION_2.maxChars}
            object={textObjects[1] ?? null}
            isSelected={selectedIndex === 1}
            onChange={onChange}
            onDelete={onDelete}
            onAdd={textObjects.length === 1 ? onAdd : undefined}
          />
        )}

        {selected && option && (
          <div className="rounded-xl border border-line bg-canvas p-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">{option.label} — Style</p>

            {/* Font picker */}
            {uniqueFonts.length > 0 && (
              <FontPicker
                fonts={uniqueFonts}
                value={selected.fontFamily}
                onChange={(family) => onChange({ fontFamily: family })}
              />
            )}

            {/* Font size +/- */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted shrink-0">Size</span>
              <button
                type="button"
                onClick={() => onChange({ fontSize: Math.max(8, (selected.fontSize ?? 24) - 2) })}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-white text-ink transition-colors hover:bg-canvas shrink-0"
                aria-label="Decrease font size"
              >
                <i className="fa-solid fa-minus text-xs" />
              </button>
              <span className="min-w-[2.5rem] text-center text-sm tabular-nums">{selected.fontSize ?? 24}</span>
              <button
                type="button"
                onClick={() => onChange({ fontSize: Math.min(200, (selected.fontSize ?? 24) + 2) })}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-white text-ink transition-colors hover:bg-canvas shrink-0"
                aria-label="Increase font size"
              >
                <i className="fa-solid fa-plus text-xs" />
              </button>
            </div>

            {/* Row 2: Colour · Align (single cycle) · Bold · Italic · All Caps */}
            <div className="flex items-center gap-1.5">
              {/* Colour swatch */}
              <input
                type="color"
                value={selected.fill}
                onChange={(e) => onChange({ fill: e.target.value })}
                className="h-9 w-10 cursor-pointer rounded-lg border border-line p-0.5 shrink-0"
                aria-label="Text colour"
                title="Text colour"
              />

              {/* Alignment — single toggle button */}
              <button
                onClick={cycleAlign}
                title={`Align ${selected.align ?? "left"} (click to cycle)`}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-white text-ink transition-colors hover:bg-canvas shrink-0"
                aria-label="Cycle text alignment"
              >
                <i className={`fa-solid ${ALIGN_ICONS[(selected.align as Align) ?? "left"]} text-sm`} />
              </button>

              {/* Bold */}
              <StyleToggle
                active={selected.fontWeight >= 600}
                onToggle={() => onChange({ fontWeight: selected.fontWeight >= 600 ? 400 : 700 })}
                label="Bold"
                icon="fa-bold"
              />
              {/* Italic */}
              <StyleToggle
                active={!!selected.italic}
                onToggle={() => onChange({ italic: !selected.italic })}
                label="Italic"
                icon="fa-italic"
              />
              {/* All caps */}
              <StyleToggle
                active={!!selected.uppercase}
                onToggle={() => onChange({ uppercase: !selected.uppercase })}
                label="All caps"
                icon="fa-font"
                extra="text-[10px] tracking-widest uppercase"
              >
                AA
              </StyleToggle>
            </div>

            <Button variant="danger" onClick={onDelete} className="w-full mt-1">
              Remove
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function StyleToggle({
  active,
  onToggle,
  label,
  icon,
  extra = "",
  children,
}: {
  active: boolean;
  onToggle: () => void;
  label: string;
  icon: string;
  extra?: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex h-9 w-9 items-center justify-center rounded-lg border text-sm transition-colors shrink-0 ${
        active ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:bg-canvas"
      }`}
    >
      {children ?? <i className={`fa-solid ${icon} ${extra}`} />}
    </button>
  );
}

interface SlotProps {
  label: string;
  maxChars: number;
  object: TextObject | null;
  isSelected: boolean;
  onChange: (patch: Partial<TextObject>) => void;
  onDelete: () => void;
  onAdd?: () => void;
}

function TextSlot({ label, maxChars, object, isSelected, onChange, onAdd }: SlotProps) {
  const charCount = object?.text?.length ?? 0;

  if (!object) {
    return (
      <button
        onClick={onAdd}
        className="w-full rounded-xl border-2 border-dashed border-line py-4 text-center transition-colors hover:border-ink hover:bg-canvas"
      >
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
        <p className="mt-1 text-xs text-muted">Tap to add</p>
      </button>
    );
  }

  return (
    <div className={`rounded-xl border-2 p-3 transition-colors ${isSelected ? "border-ink" : "border-line"}`}>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
        <span className={`text-xs ${charCount >= maxChars ? "text-red-500" : "text-muted"}`}>
          {charCount}/{maxChars}
        </span>
      </div>
      <textarea
        ref={(el) => {
          if (!el) return;
          el.style.height = "auto";
          el.style.height = el.scrollHeight + "px";
        }}
        value={object.text}
        onChange={(e) => {
          const el = e.target;
          const val = e.target.value.slice(0, maxChars);
          onChange({ text: val });
          el.style.height = "auto";
          el.style.height = el.scrollHeight + "px";
        }}
        maxLength={maxChars}
        rows={1}
        placeholder="Enter text…"
        className="w-full resize-none overflow-hidden rounded-lg border border-line bg-white px-3 py-2 text-sm focus:border-ink focus:outline-none"
      />
    </div>
  );
}
