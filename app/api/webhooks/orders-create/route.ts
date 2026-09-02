import { webhookRoute } from "@/lib/shopify/webhook-handler";
import { recordOrder, type OrderWebhookPayload } from "@/lib/orders";

export const runtime = "nodejs";

export const POST = webhookRoute<OrderWebhookPayload>(async (payload, { shopDomain }) => {
  await recordOrder(shopDomain, payload);
});
