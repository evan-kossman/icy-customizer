import { NextRequest, NextResponse } from "next/server";
import { authorizeUrl, newNonce } from "@/lib/shopify/oauth";
import { isValidShopDomain } from "@/lib/shopify/verify";

export const runtime = "nodejs";

/**
 * Install entry point. Shopify sends the merchant here with ?shop=...
 * The nonce is stored in an httpOnly cookie and verified on callback to
 * prevent an attacker from completing an install we didn't start.
 */
export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get("shop");
  if (!isValidShopDomain(shop)) {
    return NextResponse.json(
      { error: "A valid ?shop=<store>.myshopify.com parameter is required." },
      { status: 400 }
    );
  }

  const state = newNonce();
  const res = NextResponse.redirect(authorizeUrl(shop, state));
  res.cookies.set("icy_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
