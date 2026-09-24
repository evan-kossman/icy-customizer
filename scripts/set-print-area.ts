#!/usr/bin/env tsx
/**
 * Sets the print-area placement for a product (fractions of the mockup image)
 * and its physical print size.
 *
 *   npx tsx scripts/set-print-area.ts --product-id 10307860168930 \
 *     --x 0.368 --y 0.37 --w 0.28 --h 0.22 --width-in 12 --height-in 9.4
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 ? args[i + 1] : undefined;
};
const num = (n: string) => (flag(n) !== undefined ? Number(flag(n)) : undefined);

const productId = flag("product-id");
if (!productId) {
  console.error("--product-id is required");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
const db = drizzle(sql, { schema });

async function main() {
  const patch = Object.fromEntries(
    Object.entries({
      printAreaX: num("x"),
      printAreaY: num("y"),
      printAreaWidth: num("w"),
      printAreaHeight: num("h"),
      printWidthInches: num("width-in"),
      printHeightInches: num("height-in"),
    }).filter(([, v]) => v !== undefined && !Number.isNaN(v))
  );
  const rows = await db
    .update(schema.productConfigs)
    .set(patch)
    .where(eq(schema.productConfigs.shopifyProductId, `gid://shopify/Product/${productId}`))
    .returning({ id: schema.productConfigs.id });
  console.log(rows.length ? `Updated ${rows.length} config(s):` : "No config found for that product.", patch);
  // Per-mockup overrides would win over the product values — clear them.
  for (const r of rows) {
    await db.update(schema.mockups)
      .set({ printAreaX: null, printAreaY: null, printAreaWidth: null, printAreaHeight: null })
      .where(eq(schema.mockups.productConfigId, r.id));
  }
}
main().then(() => sql.end()).catch(async (e) => { console.error(e.message ?? e); await sql.end(); process.exit(1); });
