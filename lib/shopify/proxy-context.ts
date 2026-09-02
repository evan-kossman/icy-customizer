import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getShop, type ShopContext } from "./admin";
import { verifyAppProxySignature } from "./verify";

/**
 * Every storefront request arrives through the Shopify App Proxy, which signs
 * it and injects `shop` and (when the customer is logged in) `logged_in_customer_id`.
 *
 * The customer id therefore comes from Shopify, not from the browser — which is
 * what makes it safe to key AI credits on.
 */
export interface ProxyContext {
  shop: ShopContext;
  shopDomain: string;
  customerId: string | null;
}

export class ProxyAuthError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function requireProxyContext(req: NextRequest): Promise<ProxyContext> {
  const params = req.nextUrl.searchParams;

  if (!verifyAppProxySignature(params)) {
    throw new ProxyAuthError("Invalid app proxy signature.", 401);
  }

  const shopDomain = params.get("shop");
  if (!shopDomain) throw new ProxyAuthError("Missing shop parameter.", 400);

  const shop = await getShop(shopDomain);
  if (!shop) throw new ProxyAuthError("This shop does not have the app installed.", 403);

  return {
    shop,
    shopDomain,
    customerId: params.get("logged_in_customer_id"),
  };
}

/**
 * Resolves an enabled product configuration. Requests for products that are
 * not configured as customizable are rejected here, so the customizer can
 * never be opened against an arbitrary product.
 */
export async function requireProductConfig(shopId: string, shopifyProductId: string) {
  const rows = await db
    .select()
    .from(schema.productConfigs)
    .where(
      and(
        eq(schema.productConfigs.shopId, shopId),
        eq(schema.productConfigs.shopifyProductId, shopifyProductId),
        eq(schema.productConfigs.enabled, true)
      )
    )
    .limit(1);

  const config = rows[0];
  if (!config) {
    throw new ProxyAuthError("This product is not configured for customization.", 404);
  }
  return config;
}

/** Normalises a numeric or GID product id to the GID form used throughout. */
export function toProductGid(value: string): string {
  return value.startsWith("gid://") ? value : `gid://shopify/Product/${value}`;
}

export function toVariantGid(value: string): string {
  return value.startsWith("gid://") ? value : `gid://shopify/ProductVariant/${value}`;
}

export function variantNumericId(gid: string): string {
  return gid.split("/").pop() ?? gid;
}
