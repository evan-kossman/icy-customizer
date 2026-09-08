/**
 * Client-side upload validation and the direct-to-storage upload flow.
 *
 * Validation here is a courtesy to the customer — the same checks run again on
 * the server, which is where they actually matter.
 */

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

  // Require both: a spoofed MIME type with a valid extension still gets
  // re-checked server-side by inspecting the actual file header.
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
 * Two-step upload: ask the server to authorise, then PUT the bytes straight to
 * object storage. The image never passes through the application server.
 */
export async function uploadImage(opts: {
  proxyBase: string;
  sessionId: string;
  file: File;
  width: number;
  height: number;
  signal?: AbortSignal;
}): Promise<UploadResult> {
  const authorise = await fetch(`${opts.proxyBase}/api/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: opts.sessionId,
      fileName: opts.file.name,
      contentType: opts.file.type,
      contentLength: opts.file.size,
      width: opts.width,
      height: opts.height,
    }),
    signal: opts.signal,
  });

  if (!authorise.ok) {
    const body = await authorise.json().catch(() => ({}));
    throw new Error(body.error ?? "Unable to upload this image. Please try again.");
  }

  const { uploadUrl, assetId, url } = (await authorise.json()) as {
    uploadUrl: string;
    assetId: string;
    url: string;
  };

  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": opts.file.type },
    body: opts.file,
    signal: opts.signal,
  });

  if (!put.ok) {
    throw new Error("Unable to upload this image. Please try again.");
  }

  return { assetId, url, width: opts.width, height: opts.height };
}

/** Requests background removal for an already-uploaded asset. */
export async function removeBackground(opts: {
  proxyBase: string;
  sessionId: string;
  assetId: string;
}): Promise<UploadResult> {
  const res = await fetch(`${opts.proxyBase}/api/background-removal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: opts.sessionId, assetId: opts.assetId }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body.error ??
        "Background removal couldn't be completed. Your original image is still available."
    );
  }

  return (await res.json()) as UploadResult;
}
