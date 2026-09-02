import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env";

/**
 * Shopify request authentication.
 *
 * Three distinct signature schemes, all keyed on the app's client secret:
 *  - OAuth callback / embedded admin requests: sorted query string, hex HMAC
 *    in the `hmac` parameter.
 *  - App Proxy requests: sorted query string with NO separators, hex HMAC in
 *    the `signature` parameter.
 *  - Webhooks: raw request body, base64 HMAC in X-Shopify-Hmac-Sha256.
 *
 * Every one uses a constant-time comparison.
 */

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** OAuth / embedded admin request signature. */
export function verifyOAuthHmac(params: URLSearchParams): boolean {
  const provided = params.get("hmac");
  if (!provided) return false;

  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .map(([k, v]) => [k, v] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const digest = createHmac("sha256", env().SHOPIFY_API_SECRET)
    .update(message)
    .digest("hex");

  return safeEqual(digest, provided);
}

/**
 * App Proxy signature. Note the differences from OAuth: the parameter is
 * `signature`, pairs are joined with no separator, and repeated parameters are
 * comma-joined.
 */
export function verifyAppProxySignature(params: URLSearchParams): boolean {
  const provided = params.get("signature");
  if (!provided) return false;

  const grouped = new Map<string, string[]>();
  for (const [k, v] of params.entries()) {
    if (k === "signature") continue;
    const list = grouped.get(k) ?? [];
    list.push(v);
    grouped.set(k, list);
  }

  const message = [...grouped.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v.join(",")}`)
    .join("");

  const digest = createHmac("sha256", env().SHOPIFY_API_SECRET)
    .update(message)
    .digest("hex");

  return safeEqual(digest, provided);
}

/** Webhook body signature. Must be given the RAW body, not a re-serialised object. */
export function verifyWebhookHmac(rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const secret = env().SHOPIFY_WEBHOOK_SECRET || env().SHOPIFY_API_SECRET;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  return safeEqual(digest, header);
}

/** Guards against an attacker pointing the OAuth flow at a domain we don't own. */
export function isValidShopDomain(shop: string | null): shop is string {
  return !!shop && /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}
