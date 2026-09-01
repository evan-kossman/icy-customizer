import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { env } from "./env";

/**
 * S3-compatible object storage (Cloudflare R2 by default).
 *
 * Two access patterns:
 *  - Customer uploads go browser -> signed PUT -> storage, so image bytes never
 *    pass through the Vercel function.
 *  - Production artwork is private and only ever served through short-lived
 *    signed GET URLs issued to authenticated admin/production staff.
 */

let client: S3Client | null = null;

function s3(): S3Client {
  if (client) return client;
  const e = env();
  client = new S3Client({
    region: e.STORAGE_REGION,
    endpoint: e.STORAGE_ENDPOINT,
    credentials: {
      accessKeyId: e.STORAGE_ACCESS_KEY,
      secretAccessKey: e.STORAGE_SECRET_KEY,
    },
    forcePathStyle: true,
  });
  return client;
}

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

/** Issues a presigned PUT so the browser can upload directly to storage. */
export async function signUpload(opts: {
  key: string;
  contentType: string;
  contentLength: number;
  expiresIn?: number;
}) {
  const e = env();
  const url = await getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: e.STORAGE_BUCKET,
      Key: opts.key,
      ContentType: opts.contentType,
      ContentLength: opts.contentLength,
    }),
    { expiresIn: opts.expiresIn ?? 300 }
  );
  return { url, key: opts.key };
}

export async function signDownload(key: string, expiresIn = 300) {
  const e = env();
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: e.STORAGE_BUCKET, Key: key }),
    { expiresIn }
  );
}

export async function putObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
) {
  const e = env();
  await s3().send(
    new PutObjectCommand({
      Bucket: e.STORAGE_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return key;
}

export async function getObject(key: string): Promise<Buffer> {
  const e = env();
  const res = await s3().send(
    new GetObjectCommand({ Bucket: e.STORAGE_BUCKET, Key: key })
  );
  const chunks: Uint8Array[] = [];
  // @ts-expect-error Node stream
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function objectExists(key: string): Promise<boolean> {
  const e = env();
  try {
    await s3().send(
      new HeadObjectCommand({ Bucket: e.STORAGE_BUCKET, Key: key })
    );
    return true;
  } catch {
    return false;
  }
}

export async function deleteObject(key: string) {
  const e = env();
  await s3().send(
    new DeleteObjectCommand({ Bucket: e.STORAGE_BUCKET, Key: key })
  );
}

/**
 * Public URL for assets that are safe to expose (mockups, stickers, editor
 * thumbnails). Production artwork must NEVER use this path.
 */
export function publicUrl(key: string): string {
  const e = env();
  if (!e.STORAGE_PUBLIC_BASE_URL) {
    throw new Error("STORAGE_PUBLIC_BASE_URL is not configured");
  }
  return `${e.STORAGE_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
}
