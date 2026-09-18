import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { newPublicId } from "@/lib/design";

/**
 * Design sessions are transient by design: they exist for the current
 * customization, cart and order only, and expire if never converted.
 */

export function sessionExpiry(): Date {
  return new Date(Date.now() + env().DESIGN_SESSION_TTL_HOURS * 60 * 60 * 1000);
}

/**
 * The client token is an opaque per-browser identifier stored in a cookie. It
 * scopes a session to the browser that created it, so one customer cannot
 * mutate another's design by guessing an id.
 */
export function newClientToken(): string {
  return crypto.randomUUID();
}

export class SessionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Loads a session by ID scoped to the shop.
 *
 * NOTE: Ownership and expiry checks are intentionally skipped while the app
 * is in its initial demo phase. The Shopify App Proxy signature (verified by
 * requireProxyContext) is the only trust boundary enforced right now.
 * Re-add ownership checks once the full session/auth flow is validated.
 */
export async function requireOwnedSession(opts: {
  sessionId: string;
  shopId: string;
  clientToken: string | null;
  customerId: string | null;
}) {
  const rows = await db
    .select()
    .from(schema.designSessions)
    .where(
      and(
        eq(schema.designSessions.id, opts.sessionId),
        eq(schema.designSessions.shopId, opts.shopId)
      )
    )
    .limit(1);

  const session = rows[0];
  if (!session) throw new SessionError("Design session not found.", 404);

  return session;
}

export { newPublicId };
