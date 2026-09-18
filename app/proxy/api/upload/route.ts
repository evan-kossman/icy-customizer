import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ProxyAuthError, requireProxyContext } from "@/lib/shopify/proxy-context";
import { SessionError, requireOwnedSession } from "@/lib/session";
import { StorageKeys, signUpload, publicUrl } from "@/lib/storage";
import { extensionFor, validateUploadRequest, type AllowedFormat } from "@/lib/image-validation";
import { createId } from "@/lib/id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE = "icy_client_token";

/**
 * Two sub-actions in one route:
 *
 *  POST { action: "token", sessionId, contentType, contentLength, width, height, assetId }
 *    → Validates the request, creates a provisional designAsset row, returns
 *      a short-lived Vercel Blob client token so the browser can upload
 *      directly without bytes passing through this function.
 *
 *  POST { action: "complete", assetId, url }
 *    → Called by the client after the direct upload succeeds. Stores the
 *      final Vercel Blob URL on the asset row.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireProxyContext(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const action = (body.action as string) ?? "token";

    // ------------------------------------------------------------------
    // action = "complete": client confirms upload and supplies the blob URL
    // ------------------------------------------------------------------
    if (action === "complete") {
      const assetId = body.assetId as string;
      const url = body.url as string;
      if (!assetId || !url) {
        return NextResponse.json({ error: "assetId and url are required." }, { status: 400 });
      }

      await db
        .update(schema.designAssets)
        .set({ storageKey: url })
        .where(eq(schema.designAssets.id, assetId));

      return NextResponse.json({ ok: true, url });
    }

    // ------------------------------------------------------------------
    // action = "token": validate, reserve DB row, return client token
    // ------------------------------------------------------------------
    const sessionId = body.sessionId as string | undefined;
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
    }

    const session = await requireOwnedSession({
      sessionId,
      shopId: ctx.shop.id,
      clientToken: req.cookies.get(COOKIE)?.value ?? null,
      customerId: ctx.customerId,
    });

    const configRows = await db
      .select()
      .from(schema.productConfigs)
      .where(eq(schema.productConfigs.id, session.productConfigId))
      .limit(1);
    const config = configRows[0];
    if (!config) {
      return NextResponse.json({ error: "Product configuration missing." }, { status: 404 });
    }

    const rejection = validateUploadRequest(
      {
        contentType: (body.contentType as string) ?? "",
        contentLength: (body.contentLength as number) ?? 0,
        width: (body.width as number) ?? 0,
        height: (body.height as number) ?? 0,
      },
      { maxBytes: config.maxUploadBytes }
    );
    if (rejection) {
      return NextResponse.json({ error: rejection.message }, { status: rejection.status });
    }

    const existing = await db
      .select({ id: schema.designAssets.id })
      .from(schema.designAssets)
      .where(eq(schema.designAssets.sessionId, session.id));

    if (existing.length >= config.maxUploads * 3) {
      return NextResponse.json(
        { error: `You can upload up to ${config.maxUploads} images.` },
        { status: 429 }
      );
    }

    const format = body.contentType as AllowedFormat;
    const key = StorageKeys.upload(session.id, extensionFor(format));

    // Reserve the asset row with a placeholder key; "complete" fills in the
    // real Vercel Blob URL once the browser finishes the direct upload.
    const assetId = (body.assetId as string) ?? createId();
    await db.insert(schema.designAssets).values({
      id: assetId,
      sessionId: session.id,
      kind: "upload",
      storageKey: key,        // placeholder; overwritten by "complete"
      mimeType: format,
      bytes: body.contentLength as number,
      width: body.width as number,
      height: body.height as number,
    });

    const { clientToken } = await signUpload({
      key,
      contentType: format,
    });

    return NextResponse.json({ clientToken, assetId, key });
  } catch (err) {
    if (err instanceof ProxyAuthError || err instanceof SessionError) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    console.error("[proxy/api/upload]", err);
    return NextResponse.json(
      { error: "Unable to upload this image. Please try again." },
      { status: 500 }
    );
  }
}
