/**
 * Server-side image validation.
 *
 * A client-declared MIME type is never trusted: the first bytes of the file
 * are checked against known magic numbers, so a renamed executable or an SVG
 * carrying script cannot be accepted as a PNG.
 */

export type AllowedFormat = "image/jpeg" | "image/png";

const SIGNATURES: { format: AllowedFormat; bytes: number[] }[] = [
  { format: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { format: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
];

export function detectFormat(buffer: Buffer): AllowedFormat | null {
  for (const signature of SIGNATURES) {
    if (signature.bytes.every((byte, i) => buffer[i] === byte)) return signature.format;
  }
  return null;
}

export function extensionFor(format: AllowedFormat): string {
  return format === "image/png" ? "png" : "jpg";
}

export interface UploadRequest {
  contentType: string;
  contentLength: number;
  width: number;
  height: number;
}

export interface UploadRejection {
  message: string;
  status: number;
}

export function validateUploadRequest(
  request: UploadRequest,
  limits: { maxBytes: number; maxDimension?: number }
): UploadRejection | null {
  if (!["image/jpeg", "image/png"].includes(request.contentType)) {
    return { message: "Please upload a JPG or PNG image.", status: 415 };
  }

  if (!Number.isFinite(request.contentLength) || request.contentLength <= 0) {
    return { message: "That file appears to be empty.", status: 400 };
  }

  if (request.contentLength > limits.maxBytes) {
    const mb = Math.round(limits.maxBytes / (1024 * 1024));
    return { message: `Images must be smaller than ${mb} MB.`, status: 413 };
  }

  if (
    !Number.isFinite(request.width) ||
    !Number.isFinite(request.height) ||
    request.width <= 0 ||
    request.height <= 0
  ) {
    return { message: "That image's dimensions could not be read.", status: 400 };
  }

  // Guards against decompression-bomb style inputs.
  const maxDimension = limits.maxDimension ?? 12000;
  if (request.width > maxDimension || request.height > maxDimension) {
    return { message: "That image is too large to use.", status: 413 };
  }

  return null;
}
