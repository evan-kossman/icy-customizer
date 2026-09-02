import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { encrypt } from "@/lib/crypto";
import { exchangeCode } from "@/lib/shopify/oauth";
import { isValidShopDomain, verifyOAuthHmac } from "@/lib/shopify/verify";
import { registerWebhooks } from "@/lib/shopify/webhooks";

export const runtime = "nodejs";

/**
 * OAuth callback. Verifies the HMAC and the state nonce, exchanges the code
 * for an offline token, stores it encrypted, and registers webhooks so the
 * install is complete with no manual follow-up.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const shop = params.get("shop");
  const code = params.get("code");
  const state = params.get("state");

  if (!isValidShopDomain(shop) || !code) {
    return NextResponse.json({ error: "Malformed OAuth callback." }, { status: 400 });
  }
  if (!verifyOAuthHmac(params)) {
    return NextResponse.json({ error: "Signature verification failed." }, { status: 401 });
  }

  const expected = req.cookies.get("icy_oauth_state")?.value;
  if (!expected || expected !== state) {
    return NextResponse.json({ error: "OAuth state mismatch." }, { status: 401 });
  }

  let token;
  try {
    token = await exchangeCode(shop, code);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Token exchange failed." },
      { status: 502 }
    );
  }

  const encrypted = encrypt(token.access_token);
  const existing = await db
    .select({ id: schema.shops.id })
    .from(schema.shops)
    .where(eq(schema.shops.domain, shop))
    .limit(1);

  let shopId: string;
  if (existing[0]) {
    shopId = existing[0].id;
    await db
      .update(schema.shops)
      .set({ accessToken: encrypted, scopes: token.scope, uninstalledAt: null })
      .where(eq(schema.shops.id, shopId));
  } else {
    const inserted = await db
      .insert(schema.shops)
      .values({ domain: shop, accessToken: encrypted, scopes: token.scope })
      .returning({ id: schema.shops.id });
    shopId = inserted[0].id;
  }

  // Best effort: a webhook registration failure must not block the install.
  try {
    await registerWebhooks({ id: shopId, domain: shop, accessToken: token.access_token });
  } catch (err) {
    console.error("[install] webhook registration failed", err);
  }

  const host = params.get("host");
  const dest = host
    ? `${env().SHOPIFY_APP_URL}/admin?shop=${shop}&host=${host}`
    : `https://admin.shopify.com/store/${shop.replace(".myshopify.com", "")}/apps`;

  const res = NextResponse.redirect(dest);
  res.cookies.delete("icy_oauth_state");
  return res;
}
