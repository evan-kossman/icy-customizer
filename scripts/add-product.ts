#!/usr/bin/env tsx
/**
 * Sets up any customizable product with any number of colours.
 *
 *   npx tsx scripts/add-product.ts --product-id 15383662493922 --type zip-hoodie \
 *     --color "Black=~/Downloads/download-photos/black/front.png" \
 *     --color "Bone=~/Downloads/download-photos/bone/front.png" \
 *     --x 0.575 --y 0.40 --w 0.10 --h 0.10 --width-in 4.5 --height-in 4.5
 *
 * Colour names must match the product's Colour option in Shopify exactly.
 * A colour's image can also be a URL:  --color "Black=https://…/image.png"
 * Optional per colour hex: --color "Bone#E8E1D3=path". Idempotent: re-running
 * replaces that colour's image; the print area is updated if flags are given.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import * as schema from "../db/schema";
import { createId } from "../lib/id";
import { putObject, StorageKeys } from "../lib/storage";

const args = process.argv.slice(2);
const one = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 ? args[i + 1] : undefined;
};
const num = (n: string) => (one(n) !== undefined ? Number(one(n)) : undefined);
const colors = args
  .flatMap((a, i) => (a === "--color" ? [args[i + 1]] : []))
  .map((spec) => {
    const eqAt = spec.indexOf("=");
    const [name, hex] = spec.slice(0, eqAt).split("#");
    const src = spec.slice(eqAt + 1);
    const isUrl = /^https?:\/\//.test(src);
    return { name: name.trim(), hex: hex ? `#${hex}` : null, path: isUrl ? src : resolve(src.replace(/^~/, homedir())), isUrl };
  });

const PRODUCT_ID = one("product-id");
if (!PRODUCT_ID || !colors.length) {
  console.error('Usage: --product-id <id> --type <name> --color "Name=path" [--color ...] [--x --y --w --h --width-in --height-in]');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
const db = drizzle(sql, { schema });

async function main() {
  const shop = (
    await db.select().from(schema.shops).where(eq(schema.shops.domain, process.env.SHOPIFY_STORE_DOMAIN!)).limit(1)
  )[0];
  if (!shop) throw new Error(`No shop row for ${process.env.SHOPIFY_STORE_DOMAIN} — reconnect the store first.`);

  const gid = `gid://shopify/Product/${PRODUCT_ID}`;
  const area = Object.fromEntries(
    Object.entries({
      printAreaX: num("x"), printAreaY: num("y"), printAreaWidth: num("w"), printAreaHeight: num("h"),
      printWidthInches: num("width-in"), printHeightInches: num("height-in"),
    }).filter(([, v]) => v !== undefined && !Number.isNaN(v))
  );

  let cfg = (
    await db.select().from(schema.productConfigs)
      .where(and(eq(schema.productConfigs.shopId, shop.id), eq(schema.productConfigs.shopifyProductId, gid)))
      .limit(1)
  )[0];
  if (!cfg) {
    const id = createId();
    await db.insert(schema.productConfigs).values({
      id, shopId: shop.id, shopifyProductId: gid, productType: one("type") ?? "apparel", enabled: true,
      printWidthInches: 12, printHeightInches: 12, dpi: 300,
      printAreaX: 0.25, printAreaY: 0.25, printAreaWidth: 0.5, printAreaHeight: 0.5,
      aiEnabled: false, backgroundRemovalEnabled: true, textEnabled: true, stickersEnabled: false,
      maxUploads: 2, maxUploadBytes: 10 * 1024 * 1024, stickerCategories: [], fontIds: [],
      ...area,
    });
    cfg = (await db.select().from(schema.productConfigs).where(eq(schema.productConfigs.id, id)))[0];
    console.log(`+ Created product config (${cfg.productType})`);
  } else {
    if (Object.keys(area).length) await db.update(schema.productConfigs).set(area).where(eq(schema.productConfigs.id, cfg.id));
    console.log(`✓ Using existing product config${Object.keys(area).length ? " (print area updated)" : ""}`);
  }

  let order = 0;
  for (const c of colors) {
    // Source can be a local file or an existing image URL (e.g. already in Blob).
    const buf = c.isUrl
      ? Buffer.from(await (await fetch(c.path)).arrayBuffer())
      : readFileSync(c.path);
    const meta = await sharp(buf).metadata();
    const ext = c.isUrl ? (meta.format === "jpeg" ? "jpg" : meta.format ?? "png") : extname(c.path).slice(1).toLowerCase() || "png";
    const url = await putObject(StorageKeys.mockup(shop.id, ext), buf, `image/${ext === "jpg" ? "jpeg" : ext}`);
    const values = {
      colorHex: c.hex,
      assetKey: url,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      sortOrder: order++,
      printAreaX: null, printAreaY: null, printAreaWidth: null, printAreaHeight: null,
    };
    const existing = await db.select({ id: schema.mockups.id }).from(schema.mockups)
      .where(and(eq(schema.mockups.productConfigId, cfg.id), eq(schema.mockups.colorName, c.name))).limit(1);
    if (existing[0]) {
      await db.update(schema.mockups).set(values).where(eq(schema.mockups.id, existing[0].id));
      console.log(`  ✓ Updated ${c.name}`);
    } else {
      await db.insert(schema.mockups).values({ id: createId(), productConfigId: cfg.id, colorName: c.name, ...values });
      console.log(`  + Added ${c.name}`);
    }
  }
  console.log("\nDone. Set the product's icy.customizable metafield to true in Shopify.");
}

main().then(() => sql.end()).catch(async (e) => { console.error(e.message ?? e); await sql.end(); process.exit(1); });
