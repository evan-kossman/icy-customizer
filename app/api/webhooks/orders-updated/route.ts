import { webhookRoute } from "@/lib/shopify/webhook-handler";
import { recordOrder, type OrderWebhookPayload } from "@/lib/orders";

export const runtime = "nodejs";

// Same handler: recordOrder is idempotent and fills in any line items that
// were not present when the order was first created.
export const POST = webhookRoute<OrderWebhookPayload>(async (payload, { shopDomain }) => {
  await recordOrder(shopDomain, payload);
});
