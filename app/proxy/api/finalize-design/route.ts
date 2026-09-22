import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ProxyAuthError, requireProxyContext } from "@/lib/shopify/proxy-context";
import { SessionError, requireOwnedSession } from "@/lib/session";
import { putObject, StorageKeys } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Print files can be large — allow up to 30 s
export const maxDuration = 30;

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; contentType: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid data URL");
  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

/**
 * Finalizes a design at cart time:
 *  1. Uploads the canvas preview JPEG and the print-file PNG to Vercel Blob
 *  2. Updates the design session with the stored keys and sets status = "submitted"
 *  3. Returns the permanent public URLs for use as Shopify line-item properties
 *
 * Called by the browser immediately before /cart/add.js so the order carries
 * the correct URLs even if the customer never returns to the customizer.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireProxyContext(req);

    const body = (await req.json()) as {
      sessionId: string;
      previewDataUrl?: string | null;
      printFileDataUrl?: string | null;
    };

    if (!body.sessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    }

    const session = await requireOwnedSession({
      sessionId: body.sessionId,
      shopId: ctx.shop.id,
      clientToken: req.headers.get("x-icy-client-token"),
      customerId: ctx.customerId,
    });

    // Upload images in parallel; skip any that weren't provided.
    const uploads: Array<Promise<{ key: "preview" | "print"; url: string }>> = [];

    if (body.previewDataUrl) {
      const { buffer, contentType } = dataUrlToBuffer(body.previewDataUrl);
      const key = StorageKeys.preview(session.id);
      uploads.push(
        putObject(key, buffer, contentType).then((url) => ({ key: "preview" as const, url }))
      );
    }

    if (body.printFileDataUrl) {
      const { buffer, contentType } = dataUrlToBuffer(body.printFileDataUrl);
      const key = StorageKeys.production(session.id);
      uploads.push(
        putObject(key, buffer, contentType).then((url) => ({ key: "print" as const, url }))
      );
    }

    const results = await Promise.all(uploads);
    const previewUrl = results.find((r) => r.key === "preview")?.url ?? null;
    const printUrl = results.find((r) => r.key === "print")?.url ?? null;

    // Persist URLs and mark submitted so autosave no longer overwrites.
    await db
      .update(schema.designSessions)
      .set({
        ...(previewUrl ? { previewKey: previewUrl } : {}),
        ...(printUrl ? { productionFileKey: printUrl } : {}),
        status: "in_cart",
      })
      .where(eq(schema.designSessions.id, session.id));

    return NextResponse.json({
      previewUrl,
      printUrl,
      designPublicId: session.publicId,
    });
  } catch (err) {
    if (err instanceof ProxyAuthError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof SessionError)
      return NextResponse.json({ error: err.message }, { status: 403 });
    console.error("[finalize-design]", err);
    return NextResponse.json({ error: "Could not finalize design." }, { status: 500 });
  }
}
