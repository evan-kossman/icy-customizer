import { config } from "dotenv";
config({ path: ".env.local" });
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
const db = drizzle(sql, { schema });

async function main() {
  const mockups = await db.select().from(schema.mockups);
  console.log("MOCKUPS:", JSON.stringify(mockups, null, 2));
  const fonts = await db.select({ id: schema.fonts.id, family: schema.fonts.family, fileKey: schema.fonts.fileKey }).from(schema.fonts).limit(3);
  console.log("FONTS SAMPLE:", JSON.stringify(fonts, null, 2));
}
main().then(() => { sql.end(); process.exit(0); }).catch(e => { console.error(e.message); sql.end(); process.exit(1); });
