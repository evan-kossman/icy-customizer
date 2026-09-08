import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ProxyAuthError, requireProxyContext } from "@/lib/shopify/proxy-context";
import { SessionError, requireOwnedSession } from "@/lib/session";
import { designFingerprint, validateDesign, type DesignDocument } from "@/lib/design";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE = "icy_client_token";

async function context(req: NextRequest, sessionId: string) {
  const ctx = await requireProxyContext(req);
  const session = await requireOwnedSession({
    sessionId,
    shopId: ctx.shop.id,
    clientToken: req.cookies.get(COOKIE)?.value ?? null,
    customerId: ctx.customerId,
  });
  return { ctx, session };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { session } = await context(req, id);
    return NextResponse.json({
      sessionId: session.id,
      designId: session.publicId,
      design: session.designJson,
      status: session.status,
      color: session.selectedColor,
      expiresAt: session.expiresAt,
    });
  } catch (err) {
    return errorResponse(err, "Could not load this design.");
  }
}

/**
 * Autosave endpoint. Accepts the structured design JSON only — never rendered
 * images — and is called on a debounce, so it must stay cheap.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { session } = await context(req, id);

    if (session.status === "ordered") {
      return NextResponse.json(
        { error: "This design has already been ordered and can no longer be changed." },
        { status: 409 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as { design?: DesignDocument };
    if (!body.design) {
      return NextResponse.json({ error: "A design payload is required." }, { status: 400 });
    }

    // Reject structurally impossible geometry (NaN, infinities) even during
    // autosave, so corruption never reaches the production renderer.
    const result = validateDesign(body.design);
    const fatal = result.errors.filter((e) => e.includes("not a finite number"));
    if (fatal.length) {
      return NextResponse.json({ error: "Invalid design geometry.", details: fatal }, { status: 400 });
    }

    await db
      .update(schema.designSessions)
      .set({
        designJson: body.design,
        designHash: designFingerprint(body.design).slice(0, 64),
        selectedColor: body.design.color ?? null,
        shopifyVariantId: body.design.baseVariantId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.designSessions.id, session.id));

    return NextResponse.json({ ok: true, overflow: result.overflow });
  } catch (err) {
    return errorResponse(err, "Could not save this design.");
  }
}

function errorResponse(err: unknown, fallback: string) {
  if (err instanceof ProxyAuthError || err instanceof SessionError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[proxy/api/session/:id]", err);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
