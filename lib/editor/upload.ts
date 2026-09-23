/**
 * Client-side upload validation and the direct-to-Vercel-Blob upload flow.
 *
 * Validation here is a courtesy to the customer — the same checks run again on
 * the server, which is where they actually matter.
 */
import { put } from "@vercel/blob/client";
import { proxyFetch } from "@/lib/client-token";

export const ACCEPTED_TYPES = ["image/jpeg", "image/png"] as const;
export const ACCEPTED_EXTENSIONS = [".jpg", ".jpeg", ".png"];

export interface ValidationFailure {
  code: "type" | "size" | "count";
  message: string;
}

export function validateFile(
  file: File,
  opts: { maxBytes: number; currentCount: number; maxCount: number }
): ValidationFailure | null {
  if (opts.currentCount >= opts.maxCount) {
    return {
      code: "count",
      message: `You can upload up to ${opts.maxCount} images.`,
    };
  }

  const extensionOk = ACCEPTED_EXTENSIONS.some((ext) =>
    file.name.toLowerCase().endsWith(ext)
  );
  const typeOk = (ACCEPTED_TYPES as readonly string[]).includes(file.type);

  if (!typeOk || !extensionOk) {
    return { code: "type", message: "Please upload a JPG or PNG image." };
  }

  if (file.size > opts.maxBytes) {
    const mb = Math.round(opts.maxBytes / (1024 * 1024));
    return { code: "size", message: `Images must be smaller than ${mb} MB.` };
  }

  return null;
}

export interface UploadResult {
  assetId: string;
  url: string;
  width: number;
  height: number;
}

/**
 * Three-step upload:
 *  1. Ask the server to validate the request and return a short-lived
 *     Vercel Blob client token.  Bytes never hit our function.
 *  2. PUT the file directly to Vercel Blob using that token.
 *  3. Tell the server the final URL so it can persist it on the DB row.
 */
export async function uploadImage(opts: {
  proxyBase: string;
  sessionId: string;
  file: File;
  width: number;
  height: number;
  signal?: AbortSignal;
}): Promise<UploadResult> {
  const assetId = crypto.randomUUID();

  // Step 1 — obtain a client token
  const tokenRes = await proxyFetch(`${opts.proxyBase}/api/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "token",
      sessionId: opts.sessionId,
      assetId,
      contentType: opts.file.type,
      contentLength: opts.file.size,
      width: opts.width,
      height: opts.height,
    }),
    signal: opts.signal,
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ??
        "Unable to upload this image. Please try again."
    );
  }

  const { clientToken, key } = (await tokenRes.json()) as {
    clientToken: string;
    key: string;
  };

  // Step 2 — upload directly to Vercel Blob (bytes never touch our function)
  const blob = await put(key, opts.file, {
    access: "public",
    token: clientToken,
  });

  // Step 3 — confirm so the server can persist the final URL
  await proxyFetch(`${opts.proxyBase}/api/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "complete", assetId, url: blob.url }),
    signal: opts.signal,
  });

  return { assetId, url: blob.url, width: opts.width, height: opts.height };
}

/** Requests background removal for an already-uploaded asset. */
export async function removeBackground(opts: {
  proxyBase: string;
  sessionId: string;
  assetId: string;
}): Promise<UploadResult> {
  const res = await proxyFetch(`${opts.proxyBase}/api/background-removal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: opts.sessionId, assetId: opts.assetId }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
    if (body.reason) console.warn("[icy] background removal failed:", res.status, body.reason);
    throw new Error(
      `${body.error ?? "Background removal couldn't be completed. Your original image is still available."}` +
        ` (${res.status}${body.reason ? ": " + body.reason : ""})`
    );
  }

  return (await res.json()) as UploadResult;
}
