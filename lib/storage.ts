import { put, del, head } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { randomUUID } from "node:crypto";

/**
 * Vercel Blob storage layer.
 *
 * Replaces the previous S3/R2 implementation — the public interface is
 * identical so no call sites outside this file needed changing.
 *
 * Two access patterns:
 *  - Customer uploads: browser obtains a short-lived client token from the
 *    server and uploads directly to Vercel Blob (bytes never hit our function).
 *  - Server-side writes (mockups, rendered artwork): putObject() streams
 *    directly from the function.
 *
 * All blobs are stored publicly. Production artwork URLs are opaque enough
 * in practice; a signed-URL layer can be added later if required.
 */

export const StorageKeys = {
  upload: (sessionId: string, ext: string) =>
    `sessions/${sessionId}/uploads/${randomUUID()}.${ext}`,
  derived: (sessionId: string, kind: string, ext: string) =>
    `sessions/${sessionId}/${kind}/${randomUUID()}.${ext}`,
  preview: (sessionId: string) => `sessions/${sessionId}/preview.png`,
  production: (sessionId: string) => `production/${sessionId}/artwork.png`,
  mockup: (shopId: string, ext: string) =>
    `shops/${shopId}/mockups/${randomUUID()}.${ext}`,
  sticker: (shopId: string, ext: string) =>
    `shops/${shopId}/stickers/${randomUUID()}.${ext}`,
  font: (shopId: string, ext: string) =>
    `shops/${shopId}/fonts/${randomUUID()}.${ext}`,
};

/**
 * Issues a short-lived client token so the browser can upload directly to
 * Vercel Blob without the bytes passing through our function.
 *
 * The caller passes { key, contentType }; the client uses the returned token
 * with @vercel/blob/client's upload() function.
 */
export async function signUpload(opts: {
  key: string;
  contentType: string;
  expiresIn?: number;
}) {
  const token = await generateClientTokenFromReadWriteToken({
    token: process.env.BLOB_READ_WRITE_TOKEN!,
    pathname: opts.key,
    allowedContentTypes: [opts.contentType],
    validUntil: Date.now() + (opts.expiresIn ?? 300) * 1000,
  });
  return { clientToken: token, key: opts.key };
}

/** Server-side write — used by the seed script and production render. */
export async function putObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<string> {
  const blob = await put(key, Buffer.isBuffer(body) ? body : Buffer.from(body), { access: "public", contentType });
  return blob.url;
}

/**
 * With Vercel Blob the "key" stored in the database IS the full public URL
 * returned by put() / upload(). publicUrl() is a pass-through kept so the
 * rest of the codebase compiles without changes.
 */
export function publicUrl(urlOrKey: string): string {
  return urlOrKey;
}

/** Returns the public URL directly — Vercel Blob URLs are always public. */
export async function signDownload(urlOrKey: string): Promise<string> {
  return urlOrKey;
}

export async function objectExists(urlOrKey: string): Promise<boolean> {
  try {
    await head(urlOrKey);
    return true;
  } catch {
    return false;
  }
}

export async function deleteObject(urlOrKey: string) {
  await del(urlOrKey);
}

export async function getObject(urlOrKey: string): Promise<Buffer> {
  const res = await fetch(urlOrKey);
  if (!res.ok) throw new Error(`Blob fetch failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
