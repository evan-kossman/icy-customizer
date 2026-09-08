"use client";

import { Card, IconButton } from "../ui";
import type { DesignObject } from "@/lib/design";

interface Props {
  objects: DesignObject[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (id: string, direction: "forward" | "backward" | "front" | "back") => void;
  onUpdate: (id: string, patch: Partial<DesignObject>) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

function layerLabel(object: DesignObject): string {
  if (object.type === "text") {
    const text = object.text.trim();
    return text ? `“${text.slice(0, 20)}${text.length > 20 ? "…" : ""}”` : "Empty text";
  }
  if (object.type === "sticker") return "Sticker";
  if (object.type === "ai-image") return "AI image";
  return "Image";
}

export default function LayersPanel({
  objects,
  selectedId,
  onSelect,
  onReorder,
  onUpdate,
  onDuplicate,
  onDelete,
}: Props) {
  // Topmost layer first, matching how designers expect a layer list to read.
  const ordered = [...objects].sort((a, b) => b.zIndex - a.zIndex);

  return (
    <Card title="Layers">
      {ordered.length === 0 ? (
        <p className="text-xs text-muted">Add an image, sticker or text to get started.</p>
      ) : (
        <ul className="space-y-2">
          {ordered.map((object) => {
            const selected = object.id === selectedId;
            return (
              <li
                key={object.id}
                className={`flex items-center gap-1 rounded-lg border p-2 ${
                  selected ? "border-accent bg-canvas" : "border-line"
                }`}
              >
                <button
                  onClick={() => onSelect(object.id)}
                  className="flex-1 truncate text-left text-sm"
                  aria-current={selected}
                >
                  {layerLabel(object)}
                </button>

                <IconButton
                  label={object.visible ? "Hide layer" : "Show layer"}
                  onClick={() => onUpdate(object.id, { visible: !object.visible })}
                >
                  {object.visible ? "👁" : "🚫"}
                </IconButton>
                <IconButton
                  label={object.locked ? "Unlock layer" : "Lock layer"}
                  onClick={() => onUpdate(object.id, { locked: !object.locked })}
                >
                  {object.locked ? "🔒" : "🔓"}
                </IconButton>
                <IconButton
                  label="Move layer up"
                  onClick={() => onReorder(object.id, "forward")}
                >
                  ↑
                </IconButton>
                <IconButton
                  label="Move layer down"
                  onClick={() => onReorder(object.id, "backward")}
                >
                  ↓
                </IconButton>
                <IconButton label="Duplicate layer" onClick={() => onDuplicate(object.id)}>
                  ⧉
                </IconButton>
                <IconButton label="Delete layer" onClick={() => onDelete(object.id)}>
                  ×
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
