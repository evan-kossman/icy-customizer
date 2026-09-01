import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Serverless-friendly connection. Vercel functions are short lived, so the
 * pool is deliberately small and cached on the module scope across warm
 * invocations.
 */
declare global {
  var __icyClient: ReturnType<typeof postgres> | undefined;
}

function client() {
  if (!globalThis.__icyClient) {
    globalThis.__icyClient = postgres(env().DATABASE_URL, {
      max: 5,
      idle_timeout: 20,
      prepare: false,
    });
  }
  return globalThis.__icyClient;
}

export const db = drizzle(client(), { schema });
export { schema };
