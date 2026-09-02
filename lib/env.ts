import { z } from "zod";

/**
 * Environment configuration. Secrets are read server-side only — nothing here
 * is ever bundled into client code (no NEXT_PUBLIC_ prefixes on secrets).
 *
 * Optional blocks degrade gracefully: if the AI or background-removal keys are
 * absent the corresponding feature reports itself unavailable rather than
 * pretending to work.
 */
const schema = z.object({
  // Shopify
  SHOPIFY_API_KEY: z.string().min(1),
  SHOPIFY_API_SECRET: z.string().min(1),
  SHOPIFY_STORE_DOMAIN: z.string().min(1),
  SHOPIFY_APP_URL: z.string().url(),
  SHOPIFY_APP_PROXY_PREFIX: z.string().default("/apps/icy-customizer"),
  SHOPIFY_API_VERSION: z.string().default("2026-07"),
  SHOPIFY_WEBHOOK_SECRET: z.string().optional(),

  // Infrastructure
  DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEY: z.string().min(32),

  // Object storage (S3-compatible: Cloudflare R2 by default)
  STORAGE_ENDPOINT: z.string().url(),
  STORAGE_REGION: z.string().default("auto"),
  STORAGE_ACCESS_KEY: z.string().min(1),
  STORAGE_SECRET_KEY: z.string().min(1),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_PUBLIC_BASE_URL: z.string().url().optional(),

  // Feature providers
  BACKGROUND_REMOVAL_PROVIDER: z
    .enum(["removebg", "replicate", "none"])
    .default("none"),
  BACKGROUND_REMOVAL_API_KEY: z.string().optional(),
  AI_PROVIDER: z.enum(["openai", "replicate", "none"]).default("none"),
  AI_API_KEY: z.string().optional(),
  AI_CREDITS_PER_CUSTOMER: z.coerce.number().int().default(5),

  DESIGN_SESSION_TTL_HOURS: z.coerce.number().int().default(72),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(
      `Invalid or missing environment configuration: ${missing}. See .env.example.`
    );
  }
  cached = parsed.data;
  return cached;
}

/** Non-throwing check used by health/status endpoints and the admin UI. */
export function envStatus() {
  const parsed = schema.safeParse(process.env);
  return parsed.success
    ? { ok: true as const, missing: [] as string[] }
    : {
        ok: false as const,
        missing: parsed.error.issues.map((i) => i.path.join(".")),
      };
}
