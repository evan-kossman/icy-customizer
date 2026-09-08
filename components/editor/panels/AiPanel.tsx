"use client";

import { useRef, useState } from "react";
import { Card, Button, Alert, Spinner, inputClass } from "../ui";

interface Props {
  proxyBase: string;
  sessionId: string;
  loggedIn: boolean;
  creditsRemaining: number | null;
  creditsTotal: number;
  onGenerated: (result: { assetId: string; url: string; width: number; height: number }) => void;
  onCreditsChanged: (remaining: number) => void;
}

export default function AiPanel({
  proxyBase,
  sessionId,
  loggedIn,
  creditsRemaining,
  creditsTotal,
  onGenerated,
  onCreditsChanged,
}: Props) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Held across retries so a failed request never double-charges a credit.
  const idempotencyKey = useRef<string | null>(null);

  const exhausted = creditsRemaining !== null && creditsRemaining <= 0;

  async function generate() {
    if (busy || !prompt.trim()) return;

    setBusy(true);
    setError(null);
    idempotencyKey.current ??= crypto.randomUUID();

    try {
      const res = await fetch(`${proxyBase}/api/ai-generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          prompt: prompt.trim(),
          idempotencyKey: idempotencyKey.current,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? "We couldn't generate that image right now. Please try again.");
      }

      onGenerated(data.asset);
      if (typeof data.creditsRemaining === "number") onCreditsChanged(data.creditsRemaining);
      idempotencyKey.current = null; // succeeded: next request is a new charge
      setPrompt("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Generate an image"
      action={
        creditsRemaining !== null ? (
          <span className="text-xs text-muted" aria-live="polite">
            {creditsRemaining}/{creditsTotal} credits
          </span>
        ) : null
      }
    >
      {!loggedIn ? (
        <Alert tone="info">
          Sign in to your account to generate images. This keeps your {creditsTotal} free
          generations tied to you rather than this browser.
        </Alert>
      ) : (
        <>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe an image to generate…"
            rows={3}
            disabled={busy || exhausted}
            aria-label="Describe an image to generate"
            className={inputClass}
          />

          <Button
            variant="primary"
            className="mt-2 w-full"
            onClick={generate}
            disabled={busy || exhausted || !prompt.trim()}
          >
            {busy ? "Generating…" : "Generate"}
          </Button>

          {busy && (
            <div className="mt-2">
              <Spinner label="Generating image…" />
            </div>
          )}
          {exhausted && (
            <div className="mt-2">
              <Alert>You have used all {creditsTotal} of your image generations.</Alert>
            </div>
          )}
          {error && (
            <div className="mt-2">
              <Alert tone="error">{error}</Alert>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
