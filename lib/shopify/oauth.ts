import { randomBytes } from "node:crypto";
import { env } from "../env";

export const SCOPES = [
  "read_products",
  "write_products",
  "read_product_listings",
  "read_inventory",
  "read_orders",
  "write_orders",
  "read_customers",
  "read_themes",
  "write_themes",
  "read_files",
  "write_files",
  "read_metaobjects",
  "write_metaobjects",
].join(",");

export function newNonce(): string {
  return randomBytes(16).toString("hex");
}

export function authorizeUrl(shop: string, state: string): string {
  const e = env();
  const params = new URLSearchParams({
    client_id: e.SHOPIFY_API_KEY,
    scope: SCOPES,
    redirect_uri: `${e.SHOPIFY_APP_URL.replace(/\/$/, "")}/api/auth/callback`,
    state,
    "grant_options[]": "", // offline token — the app acts on the shop's behalf
  });
  return `https://${shop}/admin/oauth/authorize?${params}`;
}

export interface TokenResponse {
  access_token: string;
  scope: string;
}

export async function exchangeCode(shop: string, code: string): Promise<TokenResponse> {
  const e = env();
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: e.SHOPIFY_API_KEY,
      client_secret: e.SHOPIFY_API_SECRET,
      code,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Token exchange failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`
    );
  }
  return (await res.json()) as TokenResponse;
}
