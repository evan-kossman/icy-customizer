import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import {
  ProxyAuthError,
  requireProductConfig,
  requireProxyContext,
  toProductGid,
} from "@/lib/shopify/proxy-context";
import { fetchProduct } from "@/lib/shopify/admin";
import { buildPrintArea } from "@/lib/design";
import { publicUrl } from "@/lib/storage";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The customizer's bootstrap payload: everything the editor needs to render a
 * product, assembled from Shopify (authoritative for variants, price and
 * availability) and the admin configuration (authoritative for print specs).
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireProxyContext(req);
    const raw = req.nextUrl.searchParams.get("productId");
    if (!raw) {
      return NextResponse.json({ error: "productId is required." }, { status: 400 });
    }

    const productId = toProductGid(raw);
    const config = await requireProductConfig(ctx.shop.id, productId);
    const product = await fetchProduct(ctx.shop, productId);

    if (!product) {
      return NextResponse.json({ error: "Product not found." }, { status: 404 });
    }

    const mockupRows = await db
      .select()
      .from(schema.mockups)
      .where(eq(schema.mockups.productConfigId, config.id))
      .orderBy(schema.mockups.sortOrder);

    const fontRows = config.fontIds.length
      ? await db
          .select()
          .from(schema.fonts)
          .where(
            and(
              eq(schema.fonts.shopId, ctx.shop.id),
              eq(schema.fonts.enabled, true),
              inArray(schema.fonts.id, config.fontIds)
            )
          )
          .orderBy(schema.fonts.sortOrder)
      : await db
          .select()
          .from(schema.fonts)
          .where(and(eq(schema.fonts.shopId, ctx.shop.id), eq(schema.fonts.enabled, true)))
          .orderBy(schema.fonts.sortOrder);

    const printArea = buildPrintArea(config);

    return NextResponse.json({
      product: {
        id: product.id,
        title: product.title,
        handle: product.handle,
        options: product.options,
        // Shopify remains authoritative for price and availability.
        variants: product.variants,
      },
      config: {
        id: config.id,
        productType: config.productType,
        printArea,
        features: {
          ai: config.aiEnabled,
          backgroundRemoval: config.backgroundRemovalEnabled,
          text: config.textEnabled,
          stickers: config.stickersEnabled,
        },
        maxUploads: config.maxUploads,
        maxUploadBytes: config.maxUploadBytes,
        stickerCategories: config.stickerCategories,
        aiCredits: env().AI_CREDITS_PER_CUSTOMER,
      },
      mockups: mockupRows.map((m) => ({
        colorName: m.colorName,
        colorHex: m.colorHex,
        shopifyVariantId: m.shopifyVariantId,
        url: publicUrl(m.assetKey),
        width: m.width,
        height: m.height,
        printArea: {
          x: m.printAreaX ?? config.printAreaX,
          y: m.printAreaY ?? config.printAreaY,
          width: m.printAreaWidth ?? config.printAreaWidth,
          height: m.printAreaHeight ?? config.printAreaHeight,
        },
      })),
      fonts: fontRows.map((f) => ({
        id: f.id,
        family: f.family,
        displayName: f.displayName,
        source: f.source,
        url: f.fileKey ? publicUrl(f.fileKey) : null,
        weights: f.weights,
        italicSupported: f.italicSupported,
      })),
      customer: { id: ctx.customerId, loggedIn: !!ctx.customerId },
    });
  } catch (err) {
    if (err instanceof ProxyAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[proxy/config]", err);
    return NextResponse.json({ error: "Could not load the product configuration." }, { status: 500 });
  }
}
