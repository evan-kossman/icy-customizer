import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { webhookRoute } from "@/lib/shopify/webhook-handler";

export const runtime = "nodejs";

/**
 * Marks the shop uninstalled. The row is retained rather than deleted so that
 * design and order records tied to past production work survive.
 */
export const POST = webhookRoute<unknown>(async (_payload, { shopDomain }) => {
  if (!shopDomain) return;
  await db
    .update(schema.shops)
    .set({ uninstalledAt: new Date() })
    .where(eq(schema.shops.domain, shopDomain));
});
