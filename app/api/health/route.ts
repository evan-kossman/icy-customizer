import { NextResponse } from "next/server";
import { envStatus } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Configuration status. Reports which environment variables are missing so a
 * half-configured deploy is obvious rather than silently broken. Never returns
 * any secret value.
 */
export async function GET() {
  const status = envStatus();

  let database = "unknown";
  if (status.ok) {
    try {
      const { db } = await import("@/db");
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`select 1`);
      database = "connected";
    } catch (err) {
      database = `error: ${err instanceof Error ? err.message : "unknown"}`;
    }
  } else {
    database = "not configured";
  }

  return NextResponse.json({
    ok: status.ok,
    missingEnv: status.missing,
    database,
    backgroundRemoval: process.env.BACKGROUND_REMOVAL_API_KEY ? "configured" : "not configured",
    ai: process.env.AI_API_KEY ? "configured" : "not configured",
  });
}
