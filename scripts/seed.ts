#!/usr/bin/env tsx
/**
 * Icy Customizer — database + R2 seed script.
 *
 * Idempotent: safe to run more than once.  Existing rows are left unchanged
 * (upsert by unique index).
 *
 * Usage:
 *   npx tsx scripts/seed.ts \
 *     --tee-id    <SHOPIFY_NUMERIC_PRODUCT_ID>  \
 *     --hoodie-id <SHOPIFY_NUMERIC_PRODUCT_ID>  \
 *     [--tee-black    path/to/tee-black.png]    \
 *     [--tee-white    path/to/tee-white.png]    \
 *     [--hoodie-black path/to/hoodie-black.png] \
 *     [--hoodie-white path/to/hoodie-white.png]
 *
 * Mockup paths are optional on first run and can be added later.
 * Product IDs are the numeric Shopify IDs visible in the admin URL, e.g. 7652341760193.
 *
 * Prerequisites:
 *   - App installed on wearicy.myshopify.com (OAuth callback ran, shop row exists)
 *   - .env.local is present with DATABASE_URL, STORAGE_* vars, etc.
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and } from "drizzle-orm";
import * as schema from "../db/schema";
import { createId } from "../lib/id";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// CLI arg parsing
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

if (!TEE_ID && !HOODIE_ID) {
  console.error(
    "Error: at least one of --tee-id or --hoodie-id is required.\n" +
      "Run: npx tsx scripts/seed.ts --tee-id <ID> --hoodie-id <ID>"
  );
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
const STORAGE_ENDPOINT = requireEnv("STORAGE_ENDPOINT");
const STORAGE_REGION = process.env.STORAGE_REGION ?? "auto";
const STORAGE_ACCESS_KEY = requireEnv("STORAGE_ACCESS_KEY");
const STORAGE_SECRET_KEY = requireEnv("STORAGE_SECRET_KEY");
const STORAGE_BUCKET = requireEnv("STORAGE_BUCKET");
const SHOPIFY_STORE_DOMAIN = requireEnv("SHOPIFY_STORE_DOMAIN");

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const sql = postgres(DATABASE_URL, { max: 1, prepare: false });
const db = drizzle(sql, { schema });

const s3 = new S3Client({
  region: STORAGE_REGION,
  endpoint: STORAGE_ENDPOINT,
  credentials: {
    accessKeyId: STORAGE_ACCESS_KEY,
    secretAccessKey: STORAGE_SECRET_KEY,
  },
  forcePathStyle: true,
});

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
        "Install the app by visiting:\n" +
        "  https://wearicy-customizer.vercel.app/api/auth?shop=wearicy.myshopify.com"
    );
  }
  return rows[0];
}

/** Upload a file to R2 if the key doesn't already exist. Returns the key. */
async function uploadMockup(
  shopId: string,
  filePath: string,
  label: string
): Promise<{ assetKey: string; width: number; height: number }> {
  const abs = resolve(filePath);
  const ext = extname(abs).slice(1).toLowerCase() || "png";
  const key = `shops/${shopId}/mockups/${label}.${ext}`;

  // Skip upload if the object already exists.
  try {
    await s3.send(new HeadObjectCommand({ Bucket: STORAGE_BUCKET, Key: key }));
    console.log(`  ✓ ${label}: already in R2 (key: ${key})`);
  } catch {
    const buf = readFileSync(abs);
    await s3.send(
      new PutObjectCommand({
        Bucket: STORAGE_BUCKET,
        Key: key,
        Body: buf,
        ContentType: `image/${ext === "jpg" ? "jpeg" : ext}`,
      })
    );
    console.log(`  ↑ ${label}: uploaded (key: ${key})`);
  }

  const meta = await sharp(resolve(filePath)).metadata();
  return {
    assetKey: key,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  };
}

async function upsertProductConfig(
  shopId: string,
  shopifyProductId: string,
  productType: string
) {
  // Tee and hoodie both use a 16×21 in print area at 300dpi.
  // The print area sits in the middle of the mockup: X=25%, Y=22%, W=50%, H=50%.
  // These fractions can be tuned per-mockup after visual inspection.
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
    aiEnabled: false,           // frozen for v1
    backgroundRemovalEnabled: true,
    textEnabled: true,
    stickersEnabled: false,     // frozen for v1
    maxUploads: 6,
    maxUploadBytes: 10 * 1024 * 1024,
    stickerCategories: [] as string[],
    fontIds: [] as string[],
  };

  // Check if a row already exists.
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

  // ---- Tee ----------------------------------------------------------------
  if (TEE_ID) {
    console.log("\n[ T-Shirt ]");
    const configId = await upsertProductConfig(shop.id, TEE_ID, "tshirt");

    if (TEE_BLACK) {
      const asset = await uploadMockup(shop.id, TEE_BLACK, "tee-black");
      await upsertMockup({ productConfigId: configId, colorName: "Black", colorHex: "#000000", ...asset });
    } else {
      console.log("  — No --tee-black path supplied; skipping mockup upload.");
      console.log("    Run with --tee-black <path> to add it later.");
    }

    if (TEE_WHITE) {
      const asset = await uploadMockup(shop.id, TEE_WHITE, "tee-white");
      await upsertMockup({ productConfigId: configId, colorName: "White", colorHex: "#FFFFFF", ...asset });
    } else {
      console.log("  — No --tee-white path supplied; skipping mockup upload.");
    }
  }

  // ---- Hoodie -------------------------------------------------------------
  if (HOODIE_ID) {
    console.log("\n[ Hoodie ]");
    const configId = await upsertProductConfig(shop.id, HOODIE_ID, "hoodie");

    if (HOODIE_BLACK) {
      const asset = await uploadMockup(shop.id, HOODIE_BLACK, "hoodie-black");
      await upsertMockup({ productConfigId: configId, colorName: "Black", colorHex: "#000000", ...asset });
    } else {
      console.log("  — No --hoodie-black path supplied; skipping mockup upload.");
    }

    if (HOODIE_WHITE) {
      const asset = await uploadMockup(shop.id, HOODIE_WHITE, "hoodie-white");
      await upsertMockup({ productConfigId: configId, colorName: "White", colorHex: "#FFFFFF", ...asset });
    } else {
      console.log("  — No --hoodie-white path supplied; skipping mockup upload.");
    }
  }

  console.log("\nDone. Next steps:");
  console.log("  1. Set the icy.customizable metafield to true on each product in Shopify admin.");
  console.log("  2. If you skipped mockup uploads, re-run with the --tee-black / --tee-white etc. flags.");
  console.log("  3. Verify: open https://wearicy.com/apps/icy-customizer?product=<handle>&productId=<id>");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
