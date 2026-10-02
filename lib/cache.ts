/**
 * Tiny in-memory TTL cache for rarely-changing lookups (shop, product setup,
 * mockups, fonts). Lives per warm serverless instance, so it cuts repeat
 * database reads without any extra infrastructure. Keep TTLs short: admin
 * changes (new mockups, print area tweaks) show up within a minute.
 */
const store = new Map<string, { expires: number; value: Promise<unknown> }>();

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;
  const value = load();
  store.set(key, { expires: Date.now() + ttlMs, value });
  // Never cache failures.
  value.catch(() => store.delete(key));
  return value;
}

export const MINUTE = 60_000;
