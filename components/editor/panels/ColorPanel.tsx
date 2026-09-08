"use client";

import { Card } from "../ui";
import type { EditorMockup } from "@/lib/editor/types";

interface Props {
  mockups: EditorMockup[];
  selectedColor: string | null;
  onSelect: (colorName: string) => void;
}

export default function ColorPanel({ mockups, selectedColor, onSelect }: Props) {
  if (!mockups.length) return null;

  return (
    <Card title="Colour">
      <ul className="flex flex-wrap gap-3">
        {mockups.map((mockup) => {
          const active = mockup.colorName === selectedColor;
          return (
            <li key={mockup.colorName}>
              <button
                onClick={() => onSelect(mockup.colorName)}
                aria-pressed={active}
                aria-label={mockup.colorName}
                className={`flex flex-col items-center gap-1 rounded-lg border p-1.5 transition-colors ${
                  active ? "border-accent" : "border-line hover:border-muted"
                }`}
              >
                <span
                  className="h-8 w-8 rounded-full border border-line"
                  style={{ background: mockup.colorHex ?? "#cccccc" }}
                />
                <span className="text-[11px]">{mockup.colorName}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
