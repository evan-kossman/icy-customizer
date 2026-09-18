#!/usr/bin/env tsx
/**
 * Icy Customizer — database seed script.
 *
 * Idempotent: safe to run more than once. Existing rows are left unchanged.
 *
 * Usage:
 *   npx tsx scripts/seed.ts \
 *     --tee-id    <SHOPIFY_NUMERIC_PRODUCT_ID>  \
 *     --hoodie-id <SHOPIFY_NUMERIC_PRODUCT_ID>  \
 *     [--tee-black    path/to/tee-black.png]    \
 *     [--tee-white    path/to/tee-white.png]    \
 *     [--hoodie-black path/to/hoodie-black.png] \
 *     [--hoodie-white path/to/hoodie-white.png]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and } from "drizzle-orm";
import * as schema from "../db/schema";
import { createId } from "../lib/id";
import { putObject, objectExists, StorageKeys } from "../lib/storage";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function flag(name: string): string | null {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? (args[idx + 1] ?? null) : null;
}

const TEE_ID = flag("tee-id");
const HOODIE_ID = flag("hoodie-id");
const TEE_BLACK = flag("tee-black");
const TEE_WHITE = flag("tee-white");
const HOODIE_BLACK = flag("hoodie-black");
const HOODIE_WHITE = flag("hoodie-white");
const TEE_BLACK_VARIANT = flag("tee-black-variant");
const TEE_WHITE_VARIANT = flag("tee-white-variant");
const HOODIE_BLACK_VARIANT = flag("hoodie-black-variant");
const HOODIE_WHITE_VARIANT = flag("hoodie-white-variant");

if (!TEE_ID && !HOODIE_ID) {
  console.error("Error: at least one of --tee-id or --hoodie-id is required.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

const DATABASE_URL = requireEnv("DATABASE_URL");
const SHOPIFY_STORE_DOMAIN = requireEnv("SHOPIFY_STORE_DOMAIN");

// ---------------------------------------------------------------------------
// DB client
// ---------------------------------------------------------------------------

const sql = postgres(DATABASE_URL, { max: 1, prepare: false });
const db = drizzle(sql, { schema });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findShop() {
  const rows = await db
    .select()
    .from(schema.shops)
    .where(eq(schema.shops.domain, SHOPIFY_STORE_DOMAIN))
    .limit(1);
  if (!rows[0]) {
    throw new Error(
      `No shop row found for ${SHOPIFY_STORE_DOMAIN}.\n` +
        "Install the app first: https://icy-customizer.vercel.app/api/auth?shop=wearicy.myshopify.com"
    );
  }
  return rows[0];
}

async function uploadMockup(
  shopId: string,
  filePath: string,
  label: string
): Promise<{ assetKey: string; width: number; height: number }> {
  const abs = resolve(filePath);
  const ext = extname(abs).slice(1).toLowerCase() || "png";
  const key = StorageKeys.mockup(shopId, label);
  const contentType = `image/${ext === "jpg" ? "jpeg" : ext}`;

  const exists = await objectExists(key);
  if (exists) {
    console.log(`  ✓ ${label}: already in Blob`);
  } else {
    const buf = readFileSync(abs);
    await putObject(key, buf, contentType);
    console.log(`  ↑ ${label}: uploaded to Vercel Blob`);
  }

  const meta = await sharp(abs).metadata();
  return { assetKey: key, width: meta.width ?? 0, height: meta.height ?? 0 };
}

async function upsertProductConfig(
  shopId: string,
  shopifyProductId: string,
  productType: string
) {
  const base = {
    shopId,
    shopifyProductId: `gid://shopify/Product/${shopifyProductId}`,
    productType,
    enabled: true,
    printWidthInches: 16,
    printHeightInches: 21,
    dpi: 300,
    printAreaX: 0.25,
    printAreaY: 0.22,
    printAreaWidth: 0.5,
    printAreaHeight: 0.5,
    aiEnabled: false,
    backgroundRemovalEnabled: true,
    textEnabled: true,
    stickersEnabled: false,
    maxUploads: 2,
    maxUploadBytes: 10 * 1024 * 1024,
    stickerCategories: [] as string[],
    fontIds: [] as string[],
  };

  const existing = await db
    .select({ id: schema.productConfigs.id })
    .from(schema.productConfigs)
    .where(
      and(
        eq(schema.productConfigs.shopId, shopId),
        eq(schema.productConfigs.shopifyProductId, base.shopifyProductId)
      )
    )
    .limit(1);

  if (existing[0]) {
    console.log(`  ✓ Product config for ${productType} already exists (id: ${existing[0].id})`);
    return existing[0].id;
  }

  const id = createId();
  await db.insert(schema.productConfigs).values({ id, ...base });
  console.log(`  + Created product config for ${productType} (id: ${id})`);
  return id;
}

async function upsertMockup(opts: {
  productConfigId: string;
  colorName: string;
  colorHex: string;
  assetKey: string;
  width: number;
  height: number;
  shopifyVariantId?: string | null;
}) {
  const existing = await db
    .select({ id: schema.mockups.id })
    .from(schema.mockups)
    .where(
      and(
        eq(schema.mockups.productConfigId, opts.productConfigId),
        eq(schema.mockups.colorName, opts.colorName)
      )
    )
    .limit(1);

  if (existing[0]) {
    console.log(`    ✓ Mockup ${opts.colorName} already exists`);
    return;
  }

  await db.insert(schema.mockups).values({
    id: createId(),
    productConfigId: opts.productConfigId,
    colorName: opts.colorName,
    colorHex: opts.colorHex,
    shopifyVariantId: opts.shopifyVariantId
      ? `gid://shopify/ProductVariant/${opts.shopifyVariantId}`
      : null,
    assetKey: opts.assetKey,
    width: opts.width,
    height: opts.height,
    sortOrder: opts.colorName === "Black" ? 0 : 1,
  });
  console.log(`    + Created mockup: ${opts.colorName}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Icy Customizer — seed");
  console.log("Shop:", SHOPIFY_STORE_DOMAIN);

  const shop = await findShop();
  console.log("Shop id:", shop.id);

  if (TEE_ID) {
    console.log("\n[ T-Shirt ]");
    const configId = await upsertProductConfig(shop.id, TEE_ID, "tshirt");

    if (TEE_BLACK) {
      const asset = await uploadMockup(shop.id, TEE_BLACK, "tee-black");
      await upsertMockup({ productConfigId: configId, colorName: "Black", colorHex: "#000000", shopifyVariantId: TEE_BLACK_VARIANT, ...asset });
    } else {
      console.log("  — No --tee-black supplied; skipping mockup upload.");
    }

    if (TEE_WHITE) {
      const asset = await uploadMockup(shop.id, TEE_WHITE, "tee-white");
      await upsertMockup({ productConfigId: configId, colorName: "White", colorHex: "#FFFFFF", shopifyVariantId: TEE_WHITE_VARIANT, ...asset });
    } else {
      console.log("  — No --tee-white supplied; skipping mockup upload.");
    }
  }

  if (HOODIE_ID) {
    console.log("\n[ Hoodie ]");
    const configId = await upsertProductConfig(shop.id, HOODIE_ID, "hoodie");

    if (HOODIE_BLACK) {
      const asset = await uploadMockup(shop.id, HOODIE_BLACK, "hoodie-black");
      await upsertMockup({ productConfigId: configId, colorName: "Black", colorHex: "#000000", shopifyVariantId: TEE_BLACK_VARIANT, ...asset });
    } else {
      console.log("  — No --hoodie-black supplied; skipping mockup upload.");
    }

    if (HOODIE_WHITE) {
      const asset = await uploadMockup(shop.id, HOODIE_WHITE, "hoodie-white");
      await upsertMockup({ productConfigId: configId, colorName: "White", colorHex: "#FFFFFF", shopifyVariantId: TEE_WHITE_VARIANT, ...asset });
    } else {
      console.log("  — No --hoodie-white supplied; skipping mockup upload.");
    }
  }

  console.log("\nDone.");
  console.log("Next: set icy.customizable = true on the product in Shopify admin metafields.");
}

main()
  .then(() => { sql.end(); process.exit(0); })
  .catch((err) => { console.error(err.message ?? err); sql.end(); process.exit(1); });
