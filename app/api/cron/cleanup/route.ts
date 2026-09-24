import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, lt, notInArray, or, isNotNull } from "drizzle-orm";
import { del, list } from "@vercel/blob";
import { db, schema } from "@/db";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Carts can sit for a while before checkout — keep in-cart designs this long. */
const IN_CART_RETENTION_DAYS = 30;
/** Cap per run so one invocation never times out; the backlog drains daily. */
const BATCH = 200;

/**
 * Daily storage cleanup (scheduled in vercel.json).
 *
 * Deletes the files + rows of designs that never became an order:
 *   - drafts with no activity for DESIGN_SESSION_TTL_HOURS (default 72h)
 *   - in-cart designs with no activity for 30 days
 *
 * NEVER touches:
 *   - sessions with status "ordered"
 *   - any session referenced by an order line item (by id or public id),
 *     even if its status is wrong — the printer's file must survive.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = req.nextUrl.searchParams.get("dry") === "1";

  const now = Date.now();
  const draftCutoff = new Date(now - env().DESIGN_SESSION_TTL_HOURS * 3600_000);
  const cartCutoff = new Date(now - IN_CART_RETENTION_DAYS * 86400_000);

  // Safety net: every session any order points at, by id or public id.
  const ordered = await db
    .select({ sid: schema.orderLineItems.sessionId, pid: schema.orderLineItems.designPublicId })
    .from(schema.orderLineItems);
  const protectedIds = ordered.map((r) => r.sid).filter((v): v is string => !!v);
  const protectedPublicIds = ordered.map((r) => r.pid).filter((v): v is string => !!v);

  const conditions = [
    or(
      and(
        inArray(schema.designSessions.status, ["draft", "confirmed", "rendering", "ready", "expired", "failed"]),
        lt(schema.designSessions.updatedAt, draftCutoff)
      ),
      and(eq(schema.designSessions.status, "in_cart"), lt(schema.designSessions.updatedAt, cartCutoff))
    ),
  ];
  if (protectedIds.length) conditions.push(notInArray(schema.designSessions.id, protectedIds));
  if (protectedPublicIds.length)
    conditions.push(notInArray(schema.designSessions.publicId, protectedPublicIds));

  const victims = await db
    .select({
      id: schema.designSessions.id,
      status: schema.designSessions.status,
      previewKey: schema.designSessions.previewKey,
      productionFileKey: schema.designSessions.productionFileKey,
    })
    .from(schema.designSessions)
    .where(and(...conditions))
    .limit(BATCH);

  let filesDeleted = 0;
  const errors: string[] = [];

  for (const s of victims) {
    try {
      const urls = new Set<string>();
      if (s.previewKey?.startsWith("https://")) urls.add(s.previewKey);
      if (s.productionFileKey?.startsWith("https://")) urls.add(s.productionFileKey);

      const assets = await db
        .select({ key: schema.designAssets.storageKey })
        .from(schema.designAssets)
        .where(and(eq(schema.designAssets.sessionId, s.id), isNotNull(schema.designAssets.storageKey)));
      for (const a of assets) if (a.key.startsWith("https://")) urls.add(a.key);

      // Catch anything stored under the session's folders (bg-removed copies,
      // superseded previews/print files) even if no row points at it.
      for (const prefix of [`sessions/${s.id}/`, `production/${s.id}/`]) {
        let cursor: string | undefined;
        do {
          const page = await list({ prefix, cursor, limit: 1000 });
          page.blobs.forEach((b) => urls.add(b.url));
          cursor = page.hasMore ? page.cursor : undefined;
        } while (cursor);
      }

      if (!dryRun) {
        const all = [...urls];
        for (let i = 0; i < all.length; i += 100) await del(all.slice(i, i + 100));
        // design_assets rows cascade with the session.
        await db.delete(schema.designSessions).where(eq(schema.designSessions.id, s.id));
      }
      filesDeleted += urls.size;
    } catch (err) {
      errors.push(`${s.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const summary = {
    dryRun,
    sessionsDeleted: victims.length - errors.length,
    filesDeleted,
    moreRemaining: victims.length === BATCH,
    errors: errors.slice(0, 20),
  };
  console.log("[cron/cleanup]", JSON.stringify(summary));
  return NextResponse.json(summary);
}
