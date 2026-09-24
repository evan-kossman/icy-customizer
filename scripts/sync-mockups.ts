#!/usr/bin/env tsx
/**
 * Re-populates customizer mockups from the product's current Shopify images.
 *
 * For every colour on the product, takes that colour's variant image, uploads
 * it to Vercel Blob, and upserts the mockup row (with the variant id). Colours
 * that no longer exist on the product are removed. Creates the product config
 * if the product isn't set up yet.
 *
 * Usage (run once per product):
 *   npx tsx scripts/sync-mockups.ts --handle test-product --type tshirt
 *   npx tsx scripts/sync-mockups.ts --handle <sweatshirt-handle> --type sweatshirt
 *
 * Optional: --store https://wearicy.com  (default)
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, notInArray } from "drizzle-orm";
import sharp from "sharp";
import * as schema from "../db/schema";
import { createId } from "../lib/id";
import { putObject, StorageKeys } from "../lib/storage";

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 ? args[i + 1] ?? null : null;
};
const HANDLE = flag("handle");
const TYPE = flag("type") ?? "tshirt";
const STORE = (flag("store") ?? "https://wearicy.com").replace(/\/$/, "");
if (!HANDLE) {
  console.error("Usage: npx tsx scripts/sync-mockups.ts --handle <product-handle> --type <tshirt|sweatshirt|hoodie>");
  process.exit(1);
}

const COLOR_HEX: Record<string, string> = {
  black: "#000000", white: "#FFFFFF", grey: "#9CA3AF", gray: "#9CA3AF",
  "heather grey": "#B8B8B8", navy: "#1F2A44", red: "#B91C1C", blue: "#1D4ED8",
  green: "#166534", cream: "#F5F0E1", beige: "#D6C7A8", brown: "#5B3A29",
  pink: "#F9A8D4", purple: "#6D28D9", yellow: "#FACC15", orange: "#EA580C",
};

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
const db = drizzle(sql, { schema });

type StoreVariant = { id: number; options: string[]; featured_image: { src: string } | null };
type StoreProduct = { id: number; title: string; options: { name: string }[] | string[]; images: string[]; variants: StoreVariant[] };

const abs = (src: string) => (src.startsWith("//") ? `https:${src}` : src);

async function main() {
  const res = await fetch(`${STORE}/products/${HANDLE}.js`);
  if (!res.ok) throw new Error(`Could not load ${STORE}/products/${HANDLE}.js (${res.status})`);
  const product = (await res.json()) as StoreProduct;
  console.log(`Product: ${product.title} (${product.id})`);

  const optionNames = (product.options as Array<{ name: string } | string>).map((o) =>
    typeof o === "string" ? o : o.name
  );
  const colorIdx = optionNames.findIndex((n) => /^colou?r$/i.test(n));

  // One entry per colour: first variant of that colour + its image.
  const byColor = new Map<string, { variantId: number; image: string }>();
  for (const v of product.variants) {
    const color = colorIdx >= 0 ? v.options[colorIdx] : "Default";
    if (byColor.has(color)) continue;
    const img = v.featured_image?.src ?? product.images[0];
    if (!img) continue;
    byColor.set(color, { variantId: v.id, image: abs(img) });
  }
  if (!byColor.size) throw new Error("No variant images found on this product.");

  const shopRows = await db.select().from(schema.shops).limit(2);
  const shop = shopRows.find((s) => s.domain === process.env.SHOPIFY_STORE_DOMAIN) ?? shopRows[0];
  if (!shop) throw new Error("No shop row — install the app first.");

  const gid = `gid://shopify/Product/${product.id}`;
  let cfg = (
    await db.select().from(schema.productConfigs)
      .where(and(eq(schema.productConfigs.shopId, shop.id), eq(schema.productConfigs.shopifyProductId, gid)))
      .limit(1)
  )[0];
  if (!cfg) {
    const id = createId();
    await db.insert(schema.productConfigs).values({
      id, shopId: shop.id, shopifyProductId: gid, productType: TYPE, enabled: true,
      printWidthInches: 16, printHeightInches: 21, dpi: 300,
      printAreaX: 0.25, printAreaY: 0.22, printAreaWidth: 0.5, printAreaHeight: 0.5,
      aiEnabled: false, backgroundRemovalEnabled: true, textEnabled: true, stickersEnabled: false,
      maxUploads: 2, maxUploadBytes: 10 * 1024 * 1024, stickerCategories: [], fontIds: [],
    });
    cfg = (await db.select().from(schema.productConfigs).where(eq(schema.productConfigs.id, id)))[0];
    console.log(`+ Created product config (${TYPE})`);
  } else {
    console.log(`✓ Using existing product config (${cfg.productType})`);
  }

  let order = 0;
  for (const [color, { variantId, image }] of byColor) {
    const imgRes = await fetch(image);
    if (!imgRes.ok) throw new Error(`Download failed for ${color}: ${image}`);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const meta = await sharp(buf).metadata();
    const ext = meta.format === "jpeg" ? "jpg" : meta.format ?? "png";
    const url = await putObject(StorageKeys.mockup(shop.id, ext), buf, `image/${meta.format ?? "png"}`);

    const values = {
      colorHex: COLOR_HEX[color.toLowerCase()] ?? null,
      shopifyVariantId: `gid://shopify/ProductVariant/${variantId}`,
      assetKey: url,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      sortOrder: order++,
    };
    const existing = await db.select({ id: schema.mockups.id }).from(schema.mockups)
      .where(and(eq(schema.mockups.productConfigId, cfg.id), eq(schema.mockups.colorName, color))).limit(1);
    if (existing[0]) {
      await db.update(schema.mockups).set(values).where(eq(schema.mockups.id, existing[0].id));
      console.log(`  ✓ Updated ${color}`);
    } else {
      await db.insert(schema.mockups).values({ id: createId(), productConfigId: cfg.id, colorName: color, ...values });
      console.log(`  + Created ${color}`);
    }
  }

  const removed = await db.delete(schema.mockups).where(and(
    eq(schema.mockups.productConfigId, cfg.id),
    notInArray(schema.mockups.colorName, [...byColor.keys()])
  )).returning({ c: schema.mockups.colorName });
  for (const r of removed) console.log(`  − Removed stale colour ${r.c}`);

  console.log("\nDone. Make sure the product's icy.customizable metafield is set to true.");
}

main().then(() => sql.end()).catch(async (e) => { console.error(e.message ?? e); await sql.end(); process.exit(1); });
