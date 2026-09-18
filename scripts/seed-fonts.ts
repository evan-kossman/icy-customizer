#!/usr/bin/env tsx
/**
 * Icy Customizer — seed custom fonts from public/fonts/.
 *
 * Reads every .ttf/.otf file in public/fonts/, derives a display name from the
 * filename, and upserts it into the fonts table so the text customizer can
 * offer it.  Run once; idempotent.
 *
 * Usage:
 *   npx tsx scripts/seed-fonts.ts
 *
 * Env required: DATABASE_URL, SHOPIFY_STORE_DOMAIN, NEXT_PUBLIC_APP_URL
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { readdirSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { createId } from "../lib/id";

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

const DATABASE_URL = requireEnv("DATABASE_URL");
const SHOPIFY_STORE_DOMAIN = requireEnv("SHOPIFY_STORE_DOMAIN");
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://icy-customizer.vercel.app").replace(/\/$/, "");

const sql = postgres(DATABASE_URL, { max: 1, prepare: false });
const db = drizzle(sql, { schema });

/** Turn a filename into a readable display name. */
function toDisplayName(filename: string): string {
  return basename(filename, extname(filename))
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  console.log("Icy Customizer — seed-fonts");
  console.log("Shop:", SHOPIFY_STORE_DOMAIN);
  console.log("App URL:", APP_URL);

  const shop = await db
    .select()
    .from(schema.shops)
    .where(eq(schema.shops.domain, SHOPIFY_STORE_DOMAIN))
    .limit(1)
    .then((r) => r[0]);

  if (!shop) {
    throw new Error(`No shop found for ${SHOPIFY_STORE_DOMAIN}. Install the app first.`);
  }

  const fontsDir = join(process.cwd(), "public", "fonts");
  const files = readdirSync(fontsDir).filter((f) => /\.(ttf|otf)$/i.test(f)).sort();

  console.log(`\nFound ${files.length} font files in public/fonts/\n`);

  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const family = toDisplayName(file);
    const displayName = family;
    const fileKey = `${APP_URL}/fonts/${encodeURIComponent(file)}`;

    const existing = await db
      .select({ id: schema.fonts.id })
      .from(schema.fonts)
      .where(eq(schema.fonts.family, family))
      .limit(1)
      .then((r) => r[0]);

    if (existing) {
      console.log(`  ✓ ${displayName} — already exists`);
      skipped++;
    } else {
      await db.insert(schema.fonts).values({
        id: createId(),
        shopId: shop.id,
        family,
        displayName,
        source: "custom",
        fileKey,
        weights: [400, 700],
        italicSupported: false,
        sortOrder: i,
        enabled: true,
      });
      console.log(`  + ${displayName}`);
      inserted++;
    }
  }

  console.log(`\nDone — ${inserted} inserted, ${skipped} already existed.`);
}

main()
  .then(() => { sql.end(); process.exit(0); })
  .catch((err) => { console.error(err.message ?? err); sql.end(); process.exit(1); });
