import { env } from "../env";
import { adminGraphQL, type ShopContext } from "./admin";

/**
 * Webhook subscriptions are registered programmatically at install time, so a
 * fresh install is always fully wired without a manual step.
 */
export const WEBHOOK_TOPICS = [
  { topic: "ORDERS_CREATE", path: "/api/webhooks/orders-create" },
  { topic: "ORDERS_UPDATED", path: "/api/webhooks/orders-updated" },
  { topic: "APP_UNINSTALLED", path: "/api/webhooks/app-uninstalled" },
] as const;

interface Subscription {
  id: string;
  topic: string;
  endpoint: { callbackUrl?: string };
}

async function existingSubscriptions(shop: ShopContext): Promise<Subscription[]> {
  const data = await adminGraphQL<{ webhookSubscriptions: { nodes: Subscription[] } }>(
    shop,
    `query { webhookSubscriptions(first: 50) {
       nodes { id topic endpoint { ... on WebhookHttpEndpoint { callbackUrl } } }
     } }`
  );
  return data.webhookSubscriptions.nodes;
}

/** Idempotent: only creates subscriptions that are missing or misdirected. */
export async function registerWebhooks(shop: ShopContext) {
  const base = env().SHOPIFY_APP_URL.replace(/\/$/, "");
  const existing = await existingSubscriptions(shop);
  const results: { topic: string; status: "created" | "present" | "failed"; error?: string }[] = [];

  for (const { topic, path } of WEBHOOK_TOPICS) {
    const callbackUrl = `${base}${path}`;
    const match = existing.find(
      (s) => s.topic === topic && s.endpoint?.callbackUrl === callbackUrl
    );
    if (match) {
      results.push({ topic, status: "present" });
      continue;
    }

    try {
      const data = await adminGraphQL<{
        webhookSubscriptionCreate: {
          userErrors: { message: string }[];
        };
      }>(
        shop,
        `mutation Create($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
           webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
             userErrors { message }
           }
         }`,
        { topic, sub: { callbackUrl, format: "JSON" } }
      );

      const errors = data.webhookSubscriptionCreate.userErrors;
      if (errors.length) {
        results.push({ topic, status: "failed", error: errors.map((e) => e.message).join("; ") });
      } else {
        results.push({ topic, status: "created" });
      }
    } catch (err) {
      results.push({
        topic,
        status: "failed",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return results;
}
