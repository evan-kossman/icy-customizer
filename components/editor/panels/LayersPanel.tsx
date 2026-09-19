"use client";

import { Card, IconButton } from "../ui";
import type { DesignObject } from "@/lib/design";

const MAX_TEXT = 2;

interface Props {
  objects: DesignObject[];
  selectedId: string | null;
  /** Max image/upload objects allowed — enforced on duplicate (#9) */
  maxUploads: number;
  onSelect: (id: string) => void;
  onReorder: (id: string, direction: "forward" | "backward" | "front" | "back") => void;
  onUpdate: (id: string, patch: Partial<DesignObject>) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

function layerLabel(object: DesignObject): string {
  if (object.type === "text") {
    const text = object.text.trim();
    return text ? `"${text.slice(0, 20)}${text.length > 20 ? "…" : ""}"` : "Empty text";
  }
  if (object.type === "sticker") return "Sticker";
  if (object.type === "ai-image") return "AI image";
  return "Image";
}

function layerIcon(object: DesignObject): string {
  if (object.type === "text") return "fa-font";
  if (object.type === "sticker") return "fa-star";
  if (object.type === "ai-image") return "fa-wand-magic-sparkles";
  return "fa-image";
}

export default function LayersPanel({
  objects,
  selectedId,
  maxUploads,
  onSelect,
  onReorder,
  onUpdate,
  onDuplicate,
  onDelete,
}: Props) {
  const ordered = [...objects].sort((a, b) => b.zIndex - a.zIndex);

  const imageCount = objects.filter(
    (o) => o.type === "upload" || o.type === "ai-image" || o.type === "sticker"
  ).length;
  const textCount = objects.filter((o) => o.type === "text").length;

  function canDuplicate(object: DesignObject): boolean {
    if (object.type === "text") return textCount < MAX_TEXT;
    return imageCount < maxUploads;
  }

  return (
    <Card title="Layers">
      {ordered.length === 0 ? (
        <p className="text-xs text-muted">Add an image, sticker or text to get started.</p>
      ) : (
        <ul className="space-y-2">
          {ordered.map((object) => {
            const selected = object.id === selectedId;
            const duplicateOk = canDuplicate(object);
            return (
              <li
                key={object.id}
                className={`flex items-center gap-1 rounded-lg border p-2 ${
                  selected ? "border-accent bg-canvas" : "border-line"
                }`}
              >
                <i className={`fa-solid ${layerIcon(object)} w-4 text-center text-xs text-muted shrink-0`} />

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
                  <i className={`fa-solid ${object.visible ? "fa-eye" : "fa-eye-slash"} text-xs`} />
                </IconButton>

                <IconButton
                  label={object.locked ? "Unlock layer" : "Lock layer"}
                  onClick={() => onUpdate(object.id, { locked: !object.locked })}
                >
                  <i className={`fa-solid ${object.locked ? "fa-lock" : "fa-lock-open"} text-xs`} />
                </IconButton>

                <IconButton label="Move layer up" onClick={() => onReorder(object.id, "forward")}>
                  <i className="fa-solid fa-chevron-up text-xs" />
                </IconButton>

                <IconButton label="Move layer down" onClick={() => onReorder(object.id, "backward")}>
                  <i className="fa-solid fa-chevron-down text-xs" />
                </IconButton>

                <IconButton
                  label={duplicateOk ? "Duplicate layer" : "Limit reached"}
                  onClick={() => duplicateOk && onDuplicate(object.id)}
                  disabled={!duplicateOk}
                >
                  <i className="fa-regular fa-copy text-xs" />
                </IconButton>

                <IconButton label="Delete layer" onClick={() => onDelete(object.id)}>
                  <i className="fa-solid fa-trash text-xs" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
