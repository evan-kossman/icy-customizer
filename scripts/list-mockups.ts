#!/usr/bin/env tsx
/** Lists every mockup image stored in Vercel Blob (newest first). */
import { config } from "dotenv";
config({ path: ".env.local" });
import { list } from "@vercel/blob";

(async () => {
  const all: { url: string; uploadedAt: Date; size: number }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: "shops/", cursor, limit: 1000 });
    all.push(...page.blobs.filter((b) => b.pathname.includes("/mockups/")));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  all.sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt));
  for (const b of all) console.log(new Date(b.uploadedAt).toISOString().slice(0, 16), `${Math.round(b.size / 1024)}KB`, b.url);
})();
