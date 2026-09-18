import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import {
  ProxyAuthError,
  requireProductConfig,
  requireProxyContext,
  toProductGid,
} from "@/lib/shopify/proxy-context";
import { newClientToken, newPublicId, sessionExpiry } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Client token comes from X-Icy-Client-Token header (cookie not forwarded by Shopify App Proxy)

/** Creates a design session for a customizable product. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireProxyContext(req);
    const body = (await req.json().catch(() => ({}))) as { productId?: string };

    if (!body.productId) {
      return NextResponse.json({ error: "productId is required." }, { status: 400 });
    }

    const productId = toProductGid(body.productId);
    // Validates that this product is genuinely configured as customizable —
    // a client cannot open a session against an arbitrary product.
    const config = await requireProductConfig(ctx.shop.id, productId);

    // Client sends its own token via header; fall back to generating one
    // server-side so the flow still works if the header is absent.
    const clientToken = req.headers.get("x-icy-client-token") || newClientToken();

    const inserted = await db
      .insert(schema.designSessions)
      .values({
        publicId: newPublicId(),
        shopId: ctx.shop.id,
        productConfigId: config.id,
        shopifyProductId: productId,
        clientToken,
        shopifyCustomerId: ctx.customerId,
        expiresAt: sessionExpiry(),
        designJson: {},
      })
      .returning({
        id: schema.designSessions.id,
        publicId: schema.designSessions.publicId,
        expiresAt: schema.designSessions.expiresAt,
      });

    const session = inserted[0];
    const res = NextResponse.json({
      sessionId: session.id,
      designId: session.publicId,
      expiresAt: session.expiresAt,
    });

    return res;
  } catch (err) {
    if (err instanceof ProxyAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[proxy/api/session]", err);
    return NextResponse.json({ error: "Could not start a design session." }, { status: 500 });
  }
}
