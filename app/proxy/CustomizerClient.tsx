"use client";
import { proxyFetch } from "@/lib/client-token";

import { useEffect, useState } from "react";
import Customizer from "@/components/editor/Customizer";
import type { EditorBootstrap, EditorMockup, EditorState, EditorVariant } from "@/lib/editor/types";
import type { ImageObject } from "@/lib/design";
import { imageQuality } from "@/lib/design";
import { Alert, Button } from "@/components/editor/ui";

// ---------------------------------------------------------------------------
// Review step
// ---------------------------------------------------------------------------

function ReviewStep({
  bootstrap,
  sessionId,
  design,
  assets,
  previewUrl,
  onBack,
}: {
  bootstrap: EditorBootstrap;
  sessionId: string;
  design: EditorState["design"];
  assets: EditorState["assets"];
  previewUrl: string | null;
  onBack: () => void;
}) {
  const { product, mockups } = bootstrap;

  // Find the mockup matching the current colour
  const mockup: EditorMockup | undefined =
    mockups.find((m) => m.colorName === design.color) ?? mockups[0];

  // Selected option values – seed from design.color for the Colour option
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const opt of product.options) {
      if (opt.name.toLowerCase() === "color" || opt.name.toLowerCase() === "colour") {
        initial[opt.name] = design.color ?? opt.values[0] ?? "";
      } else {
        initial[opt.name] = opt.values[0] ?? "";
      }
    }
    return initial;
  });

  // Resolve the currently selected variant
  const selectedVariant: EditorVariant | undefined = product.variants.find((v) =>
    v.selectedOptions.every((o) => selectedOptions[o.name] === o.value)
  );

  // Quality check — flag any uploaded image that's below 150 dpi at its
  // rendered size so we can warn the customer before they commit.
  const printArea = bootstrap.config.printArea;
  const lowQualityImages = design.objects.filter((obj) => {
    if (obj.type !== "image" && obj.type !== "ai-image") return false;
    const img = obj as ImageObject;
    const asset = assets[img.assetId];
    if (!asset) return false;
    // Temporarily merge the asset's source dimensions into the object so we
    // can reuse the shared imageQuality helper.
    const augmented: ImageObject = {
      ...img,
      sourceWidth: asset.width,
      sourceHeight: asset.height,
    };
    return imageQuality(augmented, printArea).level !== "good";
  });

  const [confirmed, setConfirmed] = useState(false);
  const [addState, setAddState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [addError, setAddError] = useState<string | null>(null);

  async function addToCart() {
    if (!selectedVariant || !confirmed) return;
    setAddState("loading");
    setAddError(null);
    try {
      const res = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              id: Number(selectedVariant.id.replace(/\D/g, "")),
              quantity: 1,
              properties: {
                _design_id: sessionId,
                _design_color: design.color ?? "",
              },
            },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.description ?? "Could not add to cart.");
      }
      setAddState("success");
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Something went wrong.");
      setAddState("error");
    }
  }

  const price = selectedVariant
    ? new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(
        Number(selectedVariant.price) / 100
      )
    : null;

  return (
    <main className="mx-auto max-w-lg p-4 space-y-6">
      {/* Back */}
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors"
      >
        <i className="fa-solid fa-arrow-left" />
        Back to editor
      </button>

      <h1 className="text-xl font-semibold">Review your design</h1>

      {/* Design preview — canvas snapshot if available, otherwise plain mockup */}
      <div className="rounded-xl overflow-hidden border border-border bg-muted/20">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Your custom design" className="w-full object-contain" />
        ) : mockup ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mockup.url} alt="Product mockup" className="w-full object-contain" />
        ) : null}
      </div>

      {/* Option selectors */}
      {product.options.map((opt) => (
        <div key={opt.name} className="space-y-1">
          <label className="block text-sm font-medium">{opt.name}</label>
          <div className="flex flex-wrap gap-2">
            {opt.values.map((val) => {
              const active = selectedOptions[opt.name] === val;
              return (
                <button
                  key={val}
                  onClick={() => setSelectedOptions((prev) => ({ ...prev, [opt.name]: val }))}
                  className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                    active
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  {val}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Price */}
      {price && (
        <p className="text-2xl font-bold">
          {price}{" "}
          <span className="text-sm font-normal text-muted">CAD</span>
        </p>
      )}

      {/* Low-quality image warning */}
      {lowQualityImages.length > 0 && (
        <Alert tone="warning">
          One or more of your images may print at lower quality. For best results, upload images
          at least 300 DPI at their printed size.
        </Alert>
      )}

      {/* Availability warning */}
      {selectedVariant && !selectedVariant.availableForSale && (
        <Alert tone="error">This option is currently out of stock.</Alert>
      )}

      {/* Confirmation checkbox */}
      {addState !== "success" && (
        <label
          className={`flex items-start gap-3 rounded-xl border-2 p-4 cursor-pointer transition-colors ${
            confirmed ? "border-primary bg-primary/5" : "border-border"
          }`}
        >
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 h-5 w-5 rounded accent-primary"
          />
          <span className="text-sm leading-snug">
            I own or have permission to use this artwork, and I authorize ICY to print it.
            I&apos;m happy with how it looks.{" "}
            <span className="font-medium">Good to go.</span>
          </span>
        </label>
      )}

      {/* Add to cart / success */}
      {addState === "success" ? (
        <div className="space-y-3">
          <Alert tone="info">Added to your cart!</Alert>
          <div className="flex gap-3">
            <Button onClick={onBack} className="flex-1">
              Keep customizing
            </Button>
            <Button
              onClick={() => { window.location.href = "/cart"; }}
              className="flex-1"
            >
              View cart
            </Button>
          </div>
        </div>
      ) : (
        <>
          {addError && <Alert tone="error">{addError}</Alert>}
          <Button
            onClick={addToCart}
            disabled={
              !selectedVariant ||
              !selectedVariant.availableForSale ||
              !confirmed ||
              addState === "loading"
            }
            className="w-full"
          >
            {addState === "loading" ? "Adding…" : "Add to Cart"}
          </Button>
        </>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Session storage helpers
// ---------------------------------------------------------------------------

interface ReviewPayload {
  design: EditorState["design"];
  assets: EditorState["assets"];
  previewUrl: string | null;
}

// ---------------------------------------------------------------------------
// Main shell
// ---------------------------------------------------------------------------

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

  // Step state
  const [step, setStep] = useState<"editor" | "review">("editor");
  const [reviewPayload, setReviewPayload] = useState<ReviewPayload | null>(null);

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

  // Listen for the continue event and browser back
  useEffect(() => {
    if (!sessionId) return;

    function enterReview() {
      try {
        const raw = window.sessionStorage.getItem(`icy:review:${sessionId}`);
        if (!raw) return;
        const payload = JSON.parse(raw) as ReviewPayload;
        setReviewPayload(payload);
        setStep("review");
      } catch {
        // ignore malformed data
      }
    }

    function onContinue() {
      enterReview();
    }

    function onPopState(e: PopStateEvent) {
      if (e.state?.step === "review") {
        enterReview();
      } else {
        setStep("editor");
        setReviewPayload(null);
      }
    }

    window.addEventListener("icy:continue", onContinue);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("icy:continue", onContinue);
      window.removeEventListener("popstate", onPopState);
    };
  }, [sessionId]);

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

  if (step === "review" && reviewPayload) {
    return (
      <ReviewStep
        bootstrap={bootstrap}
        sessionId={sessionId}
        design={reviewPayload.design}
        assets={reviewPayload.assets}
        previewUrl={reviewPayload.previewUrl}
        onBack={() => {
          window.history.back();
          setStep("editor");
          setReviewPayload(null);
        }}
      />
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
      onContinue={(state: EditorState & { previewUrl?: string | null }) => {
        const payload: ReviewPayload = {
          design: state.design,
          assets: state.assets,
          previewUrl: state.previewUrl ?? null,
        };
        window.sessionStorage.setItem(
          `icy:review:${sessionId}`,
          JSON.stringify(payload)
        );
        window.history.pushState({ step: "review" }, "", `?step=review`);
        window.dispatchEvent(new CustomEvent("icy:continue"));
      }}
    />
  );
}
