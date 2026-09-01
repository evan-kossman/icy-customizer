import { env } from "../env";

/**
 * AI image generation provider abstraction.
 *
 * Requests always originate server-side; the API key is never sent to the
 * browser. Credit accounting lives in the route handler, not here.
 */
export interface AiImageResult {
  png: Buffer;
  provider: string;
  model: string;
}

export interface AiImageProvider {
  readonly name: string;
  readonly available: boolean;
  generate(prompt: string, opts?: { size?: number }): Promise<AiImageResult>;
}

class UnavailableAi implements AiImageProvider {
  readonly name = "none";
  readonly available = false;
  async generate(): Promise<AiImageResult> {
    throw new Error(
      "No AI image provider is configured. Set AI_PROVIDER and AI_API_KEY."
    );
  }
}

/** OpenAI gpt-image-1 — supports native transparent backgrounds. */
class OpenAiProvider implements AiImageProvider {
  readonly name = "openai";
  readonly available = true;
  private model = "gpt-image-1";
  constructor(private apiKey: string) {}

  async generate(prompt: string, opts?: { size?: number }) {
    const size = opts?.size ?? 1024;
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        prompt,
        n: 1,
        size: `${size}x${size}`,
        background: "transparent",
        output_format: "png",
      }),
    });

    if (!res.ok) {
      throw new Error(
        `OpenAI image generation failed (${res.status}): ${(
          await res.text().catch(() => "")
        ).slice(0, 300)}`
      );
    }

    const body = (await res.json()) as { data: { b64_json?: string; url?: string }[] };
    const item = body.data?.[0];
    if (!item) throw new Error("OpenAI returned no image.");

    const png = item.b64_json
      ? Buffer.from(item.b64_json, "base64")
      : Buffer.from(await (await fetch(item.url!)).arrayBuffer());

    return { png, provider: this.name, model: this.model };
  }
}

/** Replicate — cheaper per image; useful as a fallback or cost-control option. */
class ReplicateAiProvider implements AiImageProvider {
  readonly name = "replicate";
  readonly available = true;
  private model = "black-forest-labs/flux-schnell";
  constructor(private apiKey: string) {}

  async generate(prompt: string) {
    const res = await fetch(
      `https://api.replicate.com/v1/models/${this.model}/predictions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Prefer: "wait=55",
        },
        body: JSON.stringify({
          input: { prompt, output_format: "png", num_outputs: 1 },
        }),
      }
    );

    if (!res.ok) {
      throw new Error(
        `Replicate generation failed (${res.status}): ${(
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
    if (!img.ok) throw new Error("Could not download the generated image.");
    return {
      png: Buffer.from(await img.arrayBuffer()),
      provider: this.name,
      model: this.model,
    };
  }
}

let cached: AiImageProvider | null = null;

export function aiImage(): AiImageProvider {
  if (cached) return cached;
  const e = env();
  const key = e.AI_API_KEY;
  if (!key || e.AI_PROVIDER === "none") cached = new UnavailableAi();
  else if (e.AI_PROVIDER === "openai") cached = new OpenAiProvider(key);
  else cached = new ReplicateAiProvider(key);
  return cached;
}
