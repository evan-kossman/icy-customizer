import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ProxyAuthError, requireProxyContext } from "@/lib/shopify/proxy-context";
import { SessionError, requireOwnedSession } from "@/lib/session";
import { StorageKeys, publicUrl, signUpload } from "@/lib/storage";
import { extensionFor, validateUploadRequest, type AllowedFormat } from "@/lib/image-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE = "icy_client_token";

/**
 * Authorises a direct browser-to-storage upload.
 *
 * The image bytes never pass through this function: we validate the request,
 * reserve an asset row, and hand back a short-lived presigned PUT. That keeps
 * serverless execution time flat regardless of file size.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireProxyContext(req);
    const body = (await req.json().catch(() => ({}))) as {
      sessionId?: string;
      contentType?: string;
      contentLength?: number;
      width?: number;
      height?: number;
    };

    if (!body.sessionId) {
      return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
    }

    const session = await requireOwnedSession({
      sessionId: body.sessionId,
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
        contentType: body.contentType ?? "",
        contentLength: body.contentLength ?? 0,
        width: body.width ?? 0,
        height: body.height ?? 0,
      },
      { maxBytes: config.maxUploadBytes }
    );
    if (rejection) {
      return NextResponse.json({ error: rejection.message }, { status: rejection.status });
    }

    // Enforce the per-session upload cap server-side, not just in the UI.
    const existing = await db
      .select({ id: schema.designAssets.id })
      .from(schema.designAssets)
      .where(eq(schema.designAssets.sessionId, session.id));

    const uploadCount = existing.length;
    if (uploadCount >= config.maxUploads * 3) {
      return NextResponse.json(
        { error: `You can upload up to ${config.maxUploads} images.` },
        { status: 429 }
      );
    }

    const format = body.contentType as AllowedFormat;
    const key = StorageKeys.upload(session.id, extensionFor(format));

    const { url: uploadUrl } = await signUpload({
      key,
      contentType: format,
      contentLength: body.contentLength!,
    });

    const inserted = await db
      .insert(schema.designAssets)
      .values({
        sessionId: session.id,
        kind: "upload",
        storageKey: key,
        mimeType: format,
        bytes: body.contentLength!,
        width: body.width!,
        height: body.height!,
      })
      .returning({ id: schema.designAssets.id });

    return NextResponse.json({
      uploadUrl,
      assetId: inserted[0].id,
      url: publicUrl(key),
    });
  } catch (err) {
    if (err instanceof ProxyAuthError || err instanceof SessionError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[proxy/api/upload]", err);
    return NextResponse.json(
      { error: "Unable to upload this image. Please try again." },
      { status: 500 }
    );
  }
}
