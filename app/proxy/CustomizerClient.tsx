"use client";
import { proxyFetch } from "@/lib/client-token";

import { useEffect, useState } from "react";
import Customizer from "@/components/editor/Customizer";
import type { EditorBootstrap, EditorState } from "@/lib/editor/types";
import { Alert, Button } from "@/components/editor/ui";

/**
 * Client shell: creates or resumes a design session, loads product config,
 * and hands control to the editor.
 *
 * Browser history is used for the editor -> review -> variants flow so Back
 * behaves the way customers expect inside a storefront.
 */
export default function CustomizerClient({
  proxyBase,
  productHandle,
  productId,
}: {
  proxyBase: string;
  productHandle: string | null;
  productId: string | null;
}) {
  const [bootstrap, setBootstrap] = useState<EditorBootstrap | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const params = new URLSearchParams();
        if (productId) params.set("productId", productId);
        if (productHandle) params.set("handle", productHandle);

        const configRes = await proxyFetch(`${proxyBase}/api/config?${params}`);
        if (!configRes.ok) {
          const body = await configRes.json().catch(() => ({}));
          throw new Error(body.error ?? "This product can't be customized right now.");
        }
        const config = (await configRes.json()) as EditorBootstrap;

        const sessionRes = await proxyFetch(`${proxyBase}/api/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: config.product.id }),
        });
        if (!sessionRes.ok) throw new Error("Could not start a design session.");
        const session = (await sessionRes.json()) as { sessionId: string };

        if (!cancelled) {
          setBootstrap(config);
          setSessionId(session.sessionId);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Something went wrong.");
        }
      }
    }

    start();
    return () => {
      cancelled = true;
    };
  }, [proxyBase, productHandle, productId]);

  // Load custom @font-face entries so Konva canvas text renders them.
  useEffect(() => {
    if (!bootstrap) return;
    for (const font of bootstrap.fonts) {
      if (!font.url) continue;
      const face = new FontFace(font.family, `url("${font.url}")`);
      face.load().then((loaded) => {
        document.fonts.add(loaded);
      }).catch(() => {
        // Non-fatal — canvas will fall back to system font.
      });
    }
  }, [bootstrap]);

  if (error) {
    return (
      <main className="mx-auto max-w-md p-8">
        <Alert tone="error">{error}</Alert>
        <Button className="mt-4" onClick={() => window.history.back()}>
          Go back
        </Button>
      </main>
    );
  }

  if (!bootstrap || !sessionId) {
    return (
      <main className="grid min-h-screen place-items-center text-sm text-muted">
        Preparing your customizer…
      </main>
    );
  }

  return (
    <Customizer
      bootstrap={bootstrap}
      sessionId={sessionId}
      proxyBase={proxyBase}
      onClose={() => {
        window.location.href = `/products/${bootstrap.product.handle}`;
      }}
      onContinue={(state: EditorState) => {
        // The review step is Stage 7; until then the design is persisted and
        // the customer is told what happens next rather than shown a dead end.
        window.sessionStorage.setItem(
          `icy:review:${sessionId}`,
          JSON.stringify({ design: state.design })
        );
        window.history.pushState({ step: "review" }, "", `?step=review`);
        window.dispatchEvent(new CustomEvent("icy:continue"));
      }}
    />
  );
}
