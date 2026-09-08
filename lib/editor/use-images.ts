"use client";

import { useEffect, useState } from "react";
import type { EditorAsset } from "./types";

/**
 * Loads asset URLs into HTMLImageElements for Konva.
 *
 * Images are cached by asset id, so re-renders never re-download, and
 * crossOrigin is set because assets are served from the storage CDN and the
 * canvas must stay untainted for client-side export.
 */
export function useImages(assets: Record<string, EditorAsset>) {
  const [images, setImages] = useState<Record<string, HTMLImageElement>>({});

  useEffect(() => {
    let cancelled = false;

    const missing = Object.values(assets).filter(
      (asset) => asset.url && !images[asset.id] && !asset.pending
    );
    if (!missing.length) return;

    Promise.all(
      missing.map(
        (asset) =>
          new Promise<[string, HTMLImageElement] | null>((resolve) => {
            const img = new window.Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve([asset.id, img]);
            img.onerror = () => resolve(null);
            img.src = asset.url;
          })
      )
    ).then((loaded) => {
      if (cancelled) return;
      const next: Record<string, HTMLImageElement> = {};
      for (const entry of loaded) if (entry) next[entry[0]] = entry[1];
      if (Object.keys(next).length) {
        setImages((current) => ({ ...current, ...next }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [assets, images]);

  return images;
}

/** Loads a single image (the garment mockup) and reports its natural size. */
export function useImage(url: string | null) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!url) {
      setImage(null);
      return;
    }
    let cancelled = false;
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (!cancelled) setImage(img);
    };
    img.onerror = () => {
      if (!cancelled) setImage(null);
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);

  return image;
}

/** Reads a File into an image element to get its intrinsic dimensions. */
export function readImageFile(file: File): Promise<{ url: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as an image."));
    };
    img.src = url;
  });
}
