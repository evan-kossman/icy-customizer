import { env } from "../env";

/**
 * Background removal provider abstraction.
 *
 * The editor only ever talks to this interface, so the underlying service can
 * be swapped (or a self-hosted model introduced) without touching the canvas
 * or any UI code.
 */
export interface BackgroundRemovalResult {
  png: Buffer;
  provider: string;
}

export interface BackgroundRemovalProvider {
  readonly name: string;
  readonly available: boolean;
  remove(input: Buffer, mimeType: string): Promise<BackgroundRemovalResult>;
}

class UnavailableProvider implements BackgroundRemovalProvider {
  readonly name = "none";
  readonly available = false;
  async remove(): Promise<BackgroundRemovalResult> {
    throw new Error(
      "No background-removal provider is configured. Set BACKGROUND_REMOVAL_PROVIDER and BACKGROUND_REMOVAL_API_KEY."
    );
  }
}

/** remove.bg — cheapest reliable hosted option at low volume. */
class RemoveBgProvider implements BackgroundRemovalProvider {
  readonly name = "removebg";
  readonly available = true;
  constructor(private apiKey: string) {}

  async remove(input: Buffer, mimeType: string) {
    const form = new FormData();
    form.append(
      "image_file",
      new Blob([new Uint8Array(input)], { type: mimeType }),
      "upload"
    );
    form.append("size", "auto");
    form.append("format", "png");

    const res = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": this.apiKey },
      body: form,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `remove.bg failed (${res.status}): ${detail.slice(0, 300)}`
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { png: buf, provider: this.name };
  }
}

/** Replicate-hosted rembg — cheaper per image, slower cold starts. */
class ReplicateBgProvider implements BackgroundRemovalProvider {
  readonly name = "replicate";
  readonly available = true;
  // 851-labs/background-remover
  private version =
    "a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc";
  constructor(private apiKey: string) {}

  async remove(input: Buffer, mimeType: string) {
    const dataUri = `data:${mimeType};base64,${input.toString("base64")}`;
    const res = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Prefer: "wait=55",
      },
      body: JSON.stringify({ version: this.version, input: { image: dataUri } }),
    });

    if (!res.ok) {
      throw new Error(
        `Replicate background removal failed (${res.status}): ${(
          await res.text().catch(() => "")
        ).slice(0, 300)}`
      );
    }

    const body = (await res.json()) as {
      status: string;
      output?: string | string[];
      error?: string;
    };
    if (body.status !== "succeeded" || !body.output) {
      throw new Error(body.error ?? `Replicate returned status ${body.status}`);
    }
    const url = Array.isArray(body.output) ? body.output[0] : body.output;
    const img = await fetch(url);
    if (!img.ok) throw new Error("Could not download the processed image.");
    return { png: Buffer.from(await img.arrayBuffer()), provider: this.name };
  }
}

let cached: BackgroundRemovalProvider | null = null;

export function backgroundRemoval(): BackgroundRemovalProvider {
  if (cached) return cached;
  const e = env();
  const key = e.BACKGROUND_REMOVAL_API_KEY;
  if (!key || e.BACKGROUND_REMOVAL_PROVIDER === "none") {
    cached = new UnavailableProvider();
  } else if (e.BACKGROUND_REMOVAL_PROVIDER === "removebg") {
    cached = new RemoveBgProvider(key);
  } else {
    cached = new ReplicateBgProvider(key);
  }
  return cached;
}
