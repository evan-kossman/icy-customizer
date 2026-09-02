import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookHmac } from "./verify";

/**
 * Shared webhook wrapper.
 *
 * Shopify retries on any non-2xx, so handler errors are logged and answered
 * with 200 only when the failure is not retryable. Genuine transient failures
 * return 500 so Shopify retries.
 */
export function webhookRoute<T>(
  handler: (payload: T, ctx: { shopDomain: string; topic: string }) => Promise<void>
) {
  return async function POST(req: NextRequest) {
    const raw = await req.text();
    const hmac = req.headers.get("x-shopify-hmac-sha256");

    if (!verifyWebhookHmac(raw, hmac)) {
      return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
    }

    const shopDomain = req.headers.get("x-shopify-shop-domain") ?? "";
    const topic = req.headers.get("x-shopify-topic") ?? "";

    let payload: T;
    try {
      payload = JSON.parse(raw) as T;
    } catch {
      // Unparseable body will never succeed on retry.
      return NextResponse.json({ ok: true, ignored: "unparseable" });
    }

    try {
      await handler(payload, { shopDomain, topic });
      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error(`[webhook:${topic}] handler failed`, err);
      return NextResponse.json({ error: "Handler failed." }, { status: 500 });
    }
  };
}
