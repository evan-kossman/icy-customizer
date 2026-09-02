import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Lazily initialised database handle.
 *
 * The connection must NOT be created at module scope: Next.js evaluates route
 * modules during the build, where DATABASE_URL is legitimately absent. The
 * proxy defers both env validation and connection setup to first real query.
 *
 * The client is cached on globalThis so warm serverless invocations reuse a
 * single small pool rather than opening one per request.
 */
declare global {
  var __icyDb: PostgresJsDatabase<typeof schema> | undefined;
  var __icySql: ReturnType<typeof postgres> | undefined;
}

function connect(): PostgresJsDatabase<typeof schema> {
  if (globalThis.__icyDb) return globalThis.__icyDb;

  globalThis.__icySql ??= postgres(env().DATABASE_URL, {
    max: 5,
    idle_timeout: 20,
    prepare: false, // required for transaction-mode poolers (PgBouncer, Neon)
  });

  globalThis.__icyDb = drizzle(globalThis.__icySql, { schema });
  return globalThis.__icyDb;
}

export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(connect(), prop, receiver);
  },
});

export { schema };
