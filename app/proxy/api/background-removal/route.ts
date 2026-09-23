import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ProxyAuthError, requireProxyContext } from "@/lib/shopify/proxy-context";
import { SessionError, requireOwnedSession } from "@/lib/session";
import { getObject, putObject, StorageKeys } from "@/lib/storage";
import { backgroundRemoval } from "@/lib/providers/background-removal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Background removal can take 10-15 s
export const maxDuration = 30;

/**
 * POST { sessionId, assetId }
 *
 * Removes the background from an uploaded image asset and returns a new asset
 * with the background-removed PNG. The original asset is preserved unchanged.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireProxyContext(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const sessionId = body.sessionId as string | undefined;
    const assetId = body.assetId as string | undefined;

    if (!sessionId || !assetId) {
      return NextResponse.json(
        { error: "sessionId and assetId are required." },
        { status: 400 }
      );
    }

    const session = await requireOwnedSession({
      sessionId,
      shopId: ctx.shop.id,
      clientToken: req.headers.get("x-icy-client-token"),
      customerId: ctx.customerId,
    });

    // Load the source asset.
    const assetRows = await db
      .select()
      .from(schema.designAssets)
      .where(eq(schema.designAssets.id, assetId))
      .limit(1);
    const asset = assetRows[0];

    if (!asset || asset.sessionId !== session.id) {
      return NextResponse.json({ error: "Asset not found." }, { status: 404 });
    }

    // Fetch the raw bytes from storage.
    const inputBuffer = await getObject(asset.storageKey);
    if (!inputBuffer) {
      return NextResponse.json(
        { error: "Could not retrieve the image for processing." },
        { status: 500 }
      );
    }

    // Remove background.
    const provider = backgroundRemoval();
    if (!provider.available) {
      return NextResponse.json(
        { error: "Background removal is not configured on this store." },
        { status: 503 }
      );
    }

    const { png } = await provider.remove(inputBuffer, asset.mimeType);

    // Store the result as a new asset alongside the original.
    const newAssetId = `${assetId}-nobg`;
    const key = StorageKeys.upload(session.id, "png");
    const url = await putObject(key, png, "image/png");

    // Persist the new asset row.
    await db
      .insert(schema.designAssets)
      .values({
        id: newAssetId,
        sessionId: session.id,
        kind: "upload",
        storageKey: url,
        mimeType: "image/png",
        bytes: png.length,
        width: asset.width,
        height: asset.height,
      })
      .onConflictDoUpdate({
        target: schema.designAssets.id,
        set: { storageKey: url, bytes: png.length },
      });

    return NextResponse.json({
      assetId: newAssetId,
      url,
      width: asset.width,
      height: asset.height,
    });
  } catch (err) {
    if (err instanceof ProxyAuthError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof SessionError)
      return NextResponse.json({ error: err.message }, { status: 403 });
    console.error("[background-removal]", err);
    return NextResponse.json(
      { error: "Background removal couldn't be completed. Your original image is still available." },
      { status: 500 }
    );
  }
}
