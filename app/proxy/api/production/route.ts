import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ProxyAuthError, requireProxyContext } from "@/lib/shopify/proxy-context";
import type { DesignDocument } from "@/lib/design";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Production sheet data for a design, keyed by publicId (e.g. ICY-XXXXXXXX).
 * Used by the store admin to see design details, download the print file, and
 * verify placement.
 */
export async function GET(req: NextRequest) {
  try {
    await requireProxyContext(req);

    const publicId = req.nextUrl.searchParams.get("id");
    if (!publicId) {
      return NextResponse.json({ error: "?id=<designPublicId> required" }, { status: 400 });
    }

    const rows = await db
      .select({
        id: schema.designSessions.id,
        publicId: schema.designSessions.publicId,
        selectedColor: schema.designSessions.selectedColor,
        designJson: schema.designSessions.designJson,
        previewKey: schema.designSessions.previewKey,
        productionFileKey: schema.designSessions.productionFileKey,
        productionWidth: schema.designSessions.productionWidth,
        productionHeight: schema.designSessions.productionHeight,
        status: schema.designSessions.status,
        createdAt: schema.designSessions.createdAt,
        shopifyProductId: schema.designSessions.shopifyProductId,
        shopifyVariantId: schema.designSessions.shopifyVariantId,
      })
      .from(schema.designSessions)
      .where(eq(schema.designSessions.publicId, publicId))
      .limit(1);

    const session = rows[0];
    if (!session) {
      return NextResponse.json({ error: "Design not found" }, { status: 404 });
    }

    const design = session.designJson as DesignDocument;
    const fontFamilies = [
      ...new Set(
        design.objects
          .filter((o) => o.type === "text")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((o) => (o as any).fontFamily as string)
          .filter(Boolean)
      ),
    ];

    const imageCount = design.objects.filter(
      (o) => o.type === "image" || o.type === "ai-image"
    ).length;
    const textCount = design.objects.filter((o) => o.type === "text").length;

    return NextResponse.json({
      publicId: session.publicId,
      status: session.status,
      selectedColor: session.selectedColor,
      shopifyProductId: session.shopifyProductId,
      shopifyVariantId: session.shopifyVariantId,
      createdAt: session.createdAt,
      previewUrl: session.previewKey,
      printFileUrl: session.productionFileKey,
      printArea: design.printArea,
      objectSummary: { images: imageCount, textLayers: textCount },
      fontsUsed: fontFamilies,
    });
  } catch (err) {
    if (err instanceof ProxyAuthError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[production]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
