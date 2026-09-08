import { NextRequest, NextResponse } from "next/server";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ProxyAuthError, requireProxyContext } from "@/lib/shopify/proxy-context";
import { publicUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Artwork library. Thumbnails are served for the grid; full art on insert. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireProxyContext(req);
    const query = req.nextUrl.searchParams.get("q")?.trim();
    const category = req.nextUrl.searchParams.get("category")?.trim();

    const conditions = [
      eq(schema.stickers.shopId, ctx.shop.id),
      eq(schema.stickers.enabled, true),
    ];
    if (category) conditions.push(eq(schema.stickers.category, category));
    if (query) {
      const like = `%${query}%`;
      conditions.push(
        or(
          ilike(schema.stickers.name, like),
          sql`EXISTS (SELECT 1 FROM unnest(${schema.stickers.tags}) AS tag WHERE tag ILIKE ${like})`
        )!
      );
    }

    const rows = await db
      .select()
      .from(schema.stickers)
      .where(and(...conditions))
      .limit(60);

    return NextResponse.json({
      stickers: rows.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        url: publicUrl(s.assetKey),
        thumbUrl: publicUrl(s.thumbKey),
        width: s.width,
        height: s.height,
      })),
    });
  } catch (err) {
    if (err instanceof ProxyAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[proxy/api/stickers]", err);
    return NextResponse.json({ error: "Artwork couldn't be loaded." }, { status: 500 });
  }
}
