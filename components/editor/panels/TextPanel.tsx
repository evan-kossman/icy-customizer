"use client";

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
  const canAdd = textObjects.length < 2;

  return (
    <Card title="Add Your Text">
      <div className="space-y-3">
        {/* Slot 1 */}
        <TextSlot
          label={TEXT_OPTION_1.label}
          maxChars={TEXT_OPTION_1.maxChars}
          object={textObjects[0] ?? null}
          fonts={fonts}
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
            fonts={fonts}
            isSelected={selectedIndex === 1}
            onChange={onChange}
            onDelete={onDelete}
            onAdd={textObjects.length === 1 ? onAdd : undefined}
          />
        )}

        {selected && option && (
          <div className="rounded-xl border border-line bg-canvas p-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">{option.label} — Style</p>

            {/* Font family */}
            {fonts.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-medium text-ink">Font</label>
                <select
                  value={selected.fontFamily}
                  onChange={(e) => onChange({ fontFamily: e.target.value })}
                  className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  style={{ fontFamily: selected.fontFamily }}
                >
                  {fonts.map((font) => (
                    <option key={font.id} value={font.family} style={{ fontFamily: font.family }}>
                      {font.displayName}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Colour + alignment */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink">Colour</label>
                <input
                  type="color"
                  value={selected.fill}
                  onChange={(e) => onChange({ fill: e.target.value })}
                  className="h-10 w-full cursor-pointer rounded-lg border border-line"
                  aria-label="Text colour"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink">Align</label>
                <div className="flex gap-1">
                  {(["left", "center", "right"] as const).map((a) => (
                    <button
                      key={a}
                      onClick={() => onChange({ align: a })}
                      className={`flex-1 rounded-lg border py-2 text-xs transition-colors ${
                        selected.align === a
                          ? "border-ink bg-ink text-white"
                          : "border-line bg-white text-ink hover:bg-canvas"
                      }`}
                      aria-pressed={selected.align === a}
                    >
                      {a === "left" ? "≡" : a === "center" ? "≡" : "≡"}
                      {a === "left" ? "L" : a === "center" ? "C" : "R"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Style toggles */}
            <div className="flex gap-2">
              {[
                { label: <strong>B</strong>, key: "bold" as const, active: selected.fontWeight >= 600, action: () => onChange({ fontWeight: selected.fontWeight >= 600 ? 400 : 700 }) },
                { label: <em>I</em>, key: "italic" as const, active: selected.italic, action: () => onChange({ italic: !selected.italic }) },
                { label: <span className="uppercase tracking-widest text-[10px]">AA</span>, key: "upper" as const, active: selected.uppercase, action: () => onChange({ uppercase: !selected.uppercase }) },
              ].map(({ label, key, active, action }) => (
                <button
                  key={key}
                  onClick={action}
                  className={`h-9 w-9 rounded-lg border text-sm transition-colors ${
                    active ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:bg-canvas"
                  }`}
                  aria-pressed={active}
                >
                  {label}
                </button>
              ))}
            </div>

            <Button variant="danger" onClick={onDelete} className="w-full">
              Remove
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

interface SlotProps {
  label: string;
  maxChars: number;
  object: TextObject | null;
  fonts: EditorFont[];
  isSelected: boolean;
  onChange: (patch: Partial<TextObject>) => void;
  onDelete: () => void;
  onAdd?: () => void;
}

function TextSlot({ label, maxChars, object, isSelected, onChange, onDelete, onAdd }: SlotProps) {
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
        value={object.text}
        onChange={(e) => {
          const val = e.target.value.slice(0, maxChars);
          onChange({ text: val });
        }}
        maxLength={maxChars}
        rows={2}
        placeholder="Enter text…"
        className="w-full resize-none rounded-lg border border-line bg-white px-3 py-2 text-sm focus:border-ink focus:outline-none"
      />
    </div>
  );
}
