import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ProxyAuthError, requireProxyContext } from "@/lib/shopify/proxy-context";
import { SessionError, requireOwnedSession } from "@/lib/session";
import { signUpload, StorageKeys } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Print files can be large — allow up to 30 s
export const maxDuration = 30;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
/**
 * The browser uploads the flat preview JPEG and the flat 300-DPI print PNG
 * straight to Vercel Blob, so large print files never hit the ~4.5 MB
 * function body limit.
 *
 *  POST { action: "tokens", sessionId }
 *    -> { preview: { key, clientToken }, print: { key, clientToken } }
 *  POST { action: "complete", sessionId, previewUrl?, printUrl? }
 *    -> { previewUrl, printUrl, designPublicId }  (marks the session in_cart)
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireProxyContext(req);
    const body = (await req.json()) as {
      action?: "tokens" | "complete";
      sessionId: string;
      previewUrl?: string | null;
      printUrl?: string | null;
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

    if (body.action === "tokens") {
      const [preview, print] = await Promise.all([
        signUpload({ key: StorageKeys.derived(session.id, "preview", "jpg"), contentType: "image/jpeg" }),
        signUpload({ key: StorageKeys.derived(session.id, "print", "png"), contentType: "image/png" }),
      ]);
      return NextResponse.json({ preview, print });
    }

    // action === "complete": only accept URLs on our own Blob store.
    const isBlob = (u?: string | null) =>
      !!u && /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(u);
    const previewUrl = isBlob(body.previewUrl) ? body.previewUrl! : null;
    const printUrl = isBlob(body.printUrl) ? body.printUrl! : null;

    await db
      .update(schema.designSessions)
      .set({
        ...(previewUrl ? { previewKey: previewUrl } : {}),
        ...(printUrl ? { productionFileKey: printUrl } : {}),
        status: "in_cart",
      })
      .where(eq(schema.designSessions.id, session.id));

    return NextResponse.json({ previewUrl, printUrl, designPublicId: session.publicId });
  } catch (err) {
    if (err instanceof ProxyAuthError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof SessionError)
      return NextResponse.json({ error: err.message }, { status: 403 });
    console.error("[finalize-design]", err);
    return NextResponse.json({ error: "Could not finalize design." }, { status: 500 });
  }
}
