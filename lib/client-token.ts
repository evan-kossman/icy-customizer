/**
 * Client-side identity token for design session ownership.
 *
 * Shopify App Proxy strips Set-Cookie headers — cookies set by our backend
 * never reach the browser. We use localStorage instead: a UUID is generated
 * once per browser, persisted, and sent as X-Icy-Client-Token on every
 * proxied API call. The backend reads it from the header.
 */

const TOKEN_KEY = "icy:client_token";

/** Returns the persistent client token, creating one if this is a new browser. */
export function getOrCreateClientToken(): string {
  try {
    const existing = localStorage.getItem(TOKEN_KEY);
    if (existing) return existing;
    const token = crypto.randomUUID();
    localStorage.setItem(TOKEN_KEY, token);
    return token;
  } catch {
    // localStorage unavailable (private mode, storage blocked) — generate
    // ephemeral token. Session ownership still works for the page lifetime.
    return crypto.randomUUID();
  }
}

/**
 * fetch() wrapper that automatically attaches the client token header on
 * every request to the app proxy. Use this for all /apps/icy-customizer/api/*
 * calls; do not use it for third-party requests (Vercel Blob direct upload).
 */
export function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getOrCreateClientToken();
  return fetch(url, {
    ...init,
    headers: {
      ...init?.headers,
      "X-Icy-Client-Token": token,
    },
  });
}
