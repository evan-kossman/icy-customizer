"use client";

import { useEffect, useState } from "react";
import { Card, Alert, Spinner, inputClass } from "../ui";

export interface StickerItem {
  id: string;
  name: string;
  category: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
}

interface Props {
  proxyBase: string;
  categories: string[];
  onAdd: (sticker: StickerItem) => void;
}

export default function StickerPanel({ proxyBase, categories, onAdd }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("");
  const [items, setItems] = useState<StickerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (query) params.set("q", query);
        if (category) params.set("category", category);
        const res = await fetch(`${proxyBase}/api/stickers?${params}`);
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { stickers: StickerItem[] };
        if (!cancelled) setItems(data.stickers);
      } catch {
        if (!cancelled) setError("Artwork couldn't be loaded right now.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, category, proxyBase]);

  return (
    <Card title="Artwork">
      <div className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search artwork"
          aria-label="Search artwork"
          className={inputClass}
        />
        {categories.length > 0 && (
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Artwork category"
            className={inputClass}
          >
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading && (
        <div className="mt-3">
          <Spinner label="Loading artwork…" />
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <p className="mt-3 text-xs text-muted">No artwork found.</p>
      )}

      <ul className="mt-3 grid grid-cols-4 gap-2">
        {items.map((sticker) => (
          <li key={sticker.id}>
            <button
              onClick={() => onAdd(sticker)}
              className="w-full overflow-hidden rounded-lg border border-line p-1 hover:border-accent"
              aria-label={`Add ${sticker.name}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sticker.thumbUrl}
                alt={sticker.name}
                className="aspect-square w-full object-contain"
                loading="lazy"
              />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
