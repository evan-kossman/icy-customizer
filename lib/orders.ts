import { and, eq, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { adminGraphQL, getShop } from "@/lib/shopify/admin";

/** Shopify order webhook payload, narrowed to the fields we consume. */
export interface OrderWebhookPayload {
  id: number;
  name: string;
  email?: string | null;
  line_items: {
    id: number;
    variant_id: number | null;
    variant_title: string | null;
    title: string;
    quantity: number;
    properties?: { name: string; value: string }[] | null;
  }[];
}

function property(
  props: { name: string; value: string }[] | null | undefined,
  name: string
): string | null {
  return props?.find((p) => p.name === name)?.value ?? null;
}

/**
 * Associates a Shopify order with the design sessions that produced it, using
 * the `_design_id` line-item property written at cart time.
 *
 * Idempotent: order webhooks fire more than once, and orders/updated replays
 * the whole order.
 */
export async function recordOrder(shopDomain: string, payload: OrderWebhookPayload) {
  const shopRows = await db
    .select({ id: schema.shops.id })
    .from(schema.shops)
    .where(eq(schema.shops.domain, shopDomain))
    .limit(1);

  const shop = shopRows[0];
  if (!shop) {
    console.warn(`[orders] webhook for unknown shop ${shopDomain}`);
    return;
  }

  const shopifyOrderId = String(payload.id);

  const existing = await db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.shopId, shop.id),
        eq(schema.orders.shopifyOrderId, shopifyOrderId)
      )
    )
    .limit(1);

  let orderId: string;
  if (existing[0]) {
    orderId = existing[0].id;
  } else {
    const inserted = await db
      .insert(schema.orders)
      .values({
        shopId: shop.id,
        shopifyOrderId,
        orderNumber: payload.name,
        customerEmail: payload.email ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: schema.orders.id });

    if (inserted[0]) {
      orderId = inserted[0].id;
    } else {
      const raced = await db
        .select({ id: schema.orders.id })
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.shopId, shop.id),
            eq(schema.orders.shopifyOrderId, shopifyOrderId)
          )
        )
        .limit(1);
      if (!raced[0]) return;
      orderId = raced[0].id;
    }
  }

  for (const item of payload.line_items) {
    // The cart sends `_design_id` = internal session id and
    // `_design_public_id` = public id. Accept either.
    const rawDesignId = property(item.properties, "_design_id");
    const rawPublicId = property(item.properties, "_design_public_id");
    if (!rawDesignId && !rawPublicId) continue; // not a customized line

    const sessionRows = await db
      .select({ id: schema.designSessions.id, publicId: schema.designSessions.publicId })
      .from(schema.designSessions)
      .where(
        rawPublicId
          ? eq(schema.designSessions.publicId, rawPublicId)
          : or(
              eq(schema.designSessions.id, rawDesignId!),
              eq(schema.designSessions.publicId, rawDesignId!)
            )
      )
      .limit(1);
    const designPublicId = sessionRows[0]?.publicId ?? rawPublicId ?? rawDesignId!;

    const insertedLine = await db
      .insert(schema.orderLineItems)
      .values({
        orderId,
        shopifyLineItemId: String(item.id),
        shopifyVariantId: item.variant_id ? String(item.variant_id) : "",
        variantTitle: item.variant_title ?? item.title,
        quantity: item.quantity,
        sessionId: sessionRows[0]?.id ?? null,
        designPublicId,
        productionStatus: "pending",
      })
      .onConflictDoNothing()
      .returning({ id: schema.orderLineItems.id });

    // First time we've seen this line item: back up the print file into
    // Shopify Files so the printer has a copy that doesn't depend on the app.
    const printUrl = property(item.properties, "_design_print_url");
    if (insertedLine[0] && printUrl?.startsWith("https://")) {
      await copyToShopifyFiles(shopDomain, printUrl, `${payload.name} – ${item.title} – print file`).catch(
        (err) => console.error("[orders] Shopify Files copy failed", err)
      );
    }

    // Ordered sessions are exempt from expiry cleanup.
    if (sessionRows[0]) {
      await db
        .update(schema.designSessions)
        .set({ status: "ordered" })
        .where(eq(schema.designSessions.id, sessionRows[0].id));
    }
  }
}

/** Creates a Shopify Files entry from a public URL (Shopify downloads it). */
async function copyToShopifyFiles(shopDomain: string, url: string, alt: string) {
  const shop = await getShop(shopDomain);
  if (!shop) return;
  const result = await adminGraphQL<{
    fileCreate: { userErrors: { message: string }[] };
  }>(
    shop,
    `mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) { userErrors { message } }
    }`,
    { files: [{ originalSource: url, contentType: "IMAGE", alt: alt.slice(0, 512) }] }
  );
  const errs = result.fileCreate?.userErrors ?? [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
}
