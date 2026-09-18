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
 * Loads a session and verifies it belongs to the caller. Ownership is proven
 * by the client token, or by a matching logged-in customer id.
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

  const ownsByToken = !!opts.clientToken && session.clientToken === opts.clientToken;
  const ownsByCustomer =
    !!opts.customerId && session.shopifyCustomerId === opts.customerId;

  if (!ownsByToken && !ownsByCustomer) {
    throw new SessionError("This design session belongs to another session.", 403);
  }

  if (session.status === "expired" || session.expiresAt < new Date()) {
    const exp = session.expiresAt instanceof Date ? session.expiresAt.toISOString() : String(session.expiresAt);
    throw new SessionError(`Session expired [status=${session.status} expiresAt=${exp} now=${new Date().toISOString()} token_match=${ownsByToken} customer_match=${ownsByCustomer}]`, 410);
  }

  return session;
}

export { newPublicId };
