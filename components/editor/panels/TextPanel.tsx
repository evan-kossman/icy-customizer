"use client";

import { Card, Button, Field, inputClass } from "../ui";
import type { TextObject } from "@/lib/design";
import type { EditorFont } from "@/lib/editor/types";

interface Props {
  fonts: EditorFont[];
  selected: TextObject | null;
  printDpi: number;
  onAdd: () => void;
  onChange: (patch: Partial<TextObject>) => void;
  onDelete: () => void;
}

/** Font sizes are stored in print pixels; the UI shows points for familiarity. */
function pxToPt(px: number, dpi: number) {
  return Math.round((px / dpi) * 72);
}
function ptToPx(pt: number, dpi: number) {
  return Math.round((pt / 72) * dpi);
}

export default function TextPanel({
  fonts,
  selected,
  printDpi,
  onAdd,
  onChange,
  onDelete,
}: Props) {
  return (
    <Card
      title="Text"
      action={
        <Button variant="ghost" onClick={onAdd}>
          + Add text
        </Button>
      }
    >
      {!selected ? (
        <p className="text-xs text-muted">
          Add text, or select a text layer on the canvas to edit it.
        </p>
      ) : (
        <div className="space-y-3">
          <Field label="Text">
            <textarea
              value={selected.text}
              onChange={(e) => onChange({ text: e.target.value })}
              rows={2}
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Font">
              <select
                value={selected.fontFamily}
                onChange={(e) => onChange({ fontFamily: e.target.value })}
                className={inputClass}
                style={{ fontFamily: selected.fontFamily }}
              >
                {fonts.map((font) => (
                  <option key={font.id} value={font.family} style={{ fontFamily: font.family }}>
                    {font.displayName}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Size (pt)">
              <input
                type="number"
                min={6}
                max={400}
                value={pxToPt(selected.fontSize, printDpi)}
                onChange={(e) =>
                  onChange({ fontSize: ptToPx(Number(e.target.value) || 12, printDpi) })
                }
                className={inputClass}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Colour">
              <input
                type="color"
                value={selected.fill}
                onChange={(e) => onChange({ fill: e.target.value })}
                className="h-10 w-full cursor-pointer rounded-lg border border-line"
                aria-label="Text colour"
              />
            </Field>

            <Field label="Alignment">
              <select
                value={selected.align}
                onChange={(e) =>
                  onChange({ align: e.target.value as TextObject["align"] })
                }
                className={inputClass}
              >
                <option value="left">Left</option>
                <option value="center">Centre</option>
                <option value="right">Right</option>
              </select>
            </Field>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant={selected.fontWeight >= 600 ? "primary" : "secondary"}
              onClick={() => onChange({ fontWeight: selected.fontWeight >= 600 ? 400 : 700 })}
              aria-pressed={selected.fontWeight >= 600}
            >
              <span className="font-bold">B</span>
            </Button>
            <Button
              variant={selected.italic ? "primary" : "secondary"}
              onClick={() => onChange({ italic: !selected.italic })}
              aria-pressed={selected.italic}
            >
              <span className="italic">I</span>
            </Button>
            <Button
              variant={selected.underline ? "primary" : "secondary"}
              onClick={() => onChange({ underline: !selected.underline })}
              aria-pressed={selected.underline}
            >
              <span className="underline">U</span>
            </Button>
            <Button
              variant={selected.uppercase ? "primary" : "secondary"}
              onClick={() => onChange({ uppercase: !selected.uppercase })}
              aria-pressed={selected.uppercase}
            >
              AA
            </Button>
          </div>

          <details className="rounded-lg border border-line px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium">
              Spacing, outline and shadow
            </summary>
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Letter spacing">
                  <input
                    type="number"
                    value={Math.round(selected.letterSpacing)}
                    onChange={(e) => onChange({ letterSpacing: Number(e.target.value) || 0 })}
                    className={inputClass}
                  />
                </Field>
                <Field label="Line height">
                  <input
                    type="number"
                    step={0.1}
                    min={0.5}
                    max={3}
                    value={selected.lineHeight}
                    onChange={(e) => onChange({ lineHeight: Number(e.target.value) || 1 })}
                    className={inputClass}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Outline colour">
                  <input
                    type="color"
                    value={selected.strokeColor ?? "#000000"}
                    onChange={(e) => onChange({ strokeColor: e.target.value })}
                    className="h-10 w-full cursor-pointer rounded-lg border border-line"
                    aria-label="Outline colour"
                  />
                </Field>
                <Field label="Outline width">
                  <input
                    type="number"
                    min={0}
                    value={selected.strokeWidth ?? 0}
                    onChange={(e) => onChange({ strokeWidth: Number(e.target.value) || 0 })}
                    className={inputClass}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Shadow colour">
                  <input
                    type="color"
                    value={selected.shadowColor ?? "#000000"}
                    onChange={(e) => onChange({ shadowColor: e.target.value })}
                    className="h-10 w-full cursor-pointer rounded-lg border border-line"
                    aria-label="Shadow colour"
                  />
                </Field>
                <Field label="Shadow blur">
                  <input
                    type="number"
                    min={0}
                    value={selected.shadowBlur ?? 0}
                    onChange={(e) => onChange({ shadowBlur: Number(e.target.value) || 0 })}
                    className={inputClass}
                  />
                </Field>
              </div>
            </div>
          </details>

          <Button variant="danger" onClick={onDelete} className="w-full">
            Delete text
          </Button>
        </div>
      )}
    </Card>
  );
}
