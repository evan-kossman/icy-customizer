"use client";

import { useRef, useState } from "react";
import { Card, Button, Alert, Spinner } from "../ui";
import { validateFile } from "@/lib/editor/upload";
import { imageQuality, type ImageObject, type PrintArea } from "@/lib/design";
import type { EditorAsset } from "@/lib/editor/types";

interface Props {
  assets: EditorAsset[];
  objects: ImageObject[];
  printArea: PrintArea;
  maxUploads: number;
  maxBytes: number;
  backgroundRemovalEnabled: boolean;
  backgroundRemovalOn: boolean;
  onToggleBackgroundRemoval: (on: boolean) => void;
  onFiles: (files: File[]) => void;
  onRemove: (assetId: string) => void;
  onSelect: (objectId: string) => void;
  onToggleObjectBackground: (objectId: string, useRemoved: boolean) => void;
  busy: boolean;
  error: string | null;
}

export default function UploadPanel({
  assets,
  objects,
  printArea,
  maxUploads,
  maxBytes,
  backgroundRemovalEnabled,
  backgroundRemovalOn,
  onToggleBackgroundRemoval,
  onFiles,
  onRemove,
  onSelect,
  onToggleObjectBackground,
  busy,
  error,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const uploads = assets.filter((a) => a.kind === "upload" || a.kind === "ai_generated");
  const count = uploads.length;

  function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    const accepted: File[] = [];

    for (const file of Array.from(fileList)) {
      const failure = validateFile(file, {
        maxBytes,
        currentCount: count + accepted.length,
        maxCount: maxUploads,
      });
      if (failure) {
        setLocalError(failure.message);
        break;
      }
      accepted.push(file);
    }

    if (accepted.length) {
      setLocalError(null);
      onFiles(accepted);
    }
  }

  return (
    <Card
      title="Upload your images"
      action={
        <span className="text-xs text-muted" aria-live="polite">
          {count}/{maxUploads}
        </span>
      }
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`rounded-lg border-2 border-dashed p-5 text-center transition-colors ${
          dragging ? "border-accent bg-canvas" : "border-line"
        }`}
      >
        <p className="text-sm text-muted">Drag images here, or</p>
        <Button
          className="mt-2"
          onClick={() => inputRef.current?.click()}
          disabled={busy || count >= maxUploads}
        >
          Choose files
        </Button>
        <p className="mt-2 text-xs text-muted">
          JPG or PNG, up to {Math.round(maxBytes / (1024 * 1024))} MB each
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,.jpg,.jpeg,.png"
          multiple
          className="sr-only"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {backgroundRemovalEnabled && (
        <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
          <span className="text-sm">Remove image background</span>
          <input
            type="checkbox"
            checked={backgroundRemovalOn}
            onChange={(e) => onToggleBackgroundRemoval(e.target.checked)}
          />
        </label>
      )}

      {busy && (
        <div className="mt-3">
          <Spinner label="Uploading image…" />
        </div>
      )}

      {(error || localError) && (
        <div className="mt-3">
          <Alert tone="error">{error ?? localError}</Alert>
        </div>
      )}

      {uploads.length > 0 && (
        <ul className="mt-3 grid grid-cols-3 gap-3">
          {uploads.map((asset) => {
            const object = objects.find(
              (o) => o.assetId === asset.id || o.originalAssetId === asset.id
            );
            const quality = object ? imageQuality(object, printArea) : null;

            return (
              <li key={asset.id} className="relative">
                <button
                  onClick={() => object && onSelect(object.id)}
                  className="block w-full overflow-hidden rounded-lg border border-line"
                  aria-label="Select this image on the canvas"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={asset.url}
                    alt=""
                    className="aspect-square w-full bg-canvas object-contain"
                  />
                </button>

                {asset.pending && (
                  <span className="absolute inset-0 grid place-items-center rounded-lg bg-white/70 text-[10px] text-muted">
                    Removing background…
                  </span>
                )}

                <button
                  onClick={() => onRemove(asset.id)}
                  aria-label="Delete this image"
                  className="absolute -right-2 -top-2 h-6 w-6 rounded-full border border-line bg-surface text-xs leading-none shadow-sm"
                >
                  ×
                </button>

                {quality && quality.level !== "good" && (
                  <span
                    className={`mt-1 block text-[10px] ${
                      quality.level === "invalid" ? "text-red-600" : "text-amber-700"
                    }`}
                  >
                    {quality.level === "invalid" ? "Too low resolution" : "Low resolution"}
                  </span>
                )}

                {object?.originalAssetId && (
                  <label className="mt-1 flex items-center gap-1 text-[10px] text-muted">
                    <input
                      type="checkbox"
                      checked={object.backgroundRemoved}
                      onChange={(e) => onToggleObjectBackground(object.id, e.target.checked)}
                    />
                    No background
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {objects.some((o) => imageQuality(o, printArea).level === "low") && (
        <div className="mt-3">
          <Alert>Low resolution — this image may appear blurry when printed.</Alert>
        </div>
      )}
    </Card>
  );
}
