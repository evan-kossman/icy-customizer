"use client";
import { proxyFetch } from "@/lib/client-token";
import { put } from "@vercel/blob/client";

import { useEffect, useRef, useState } from "react";
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
  designOnlyUrl,
  printFileUrl,
  proxyBase,
  onBack,
}: {
  bootstrap: EditorBootstrap;
  sessionId: string;
  design: EditorState["design"];
  assets: EditorState["assets"];
  previewUrl: string | null;
  designOnlyUrl: string | null;
  printFileUrl: string | null;
  proxyBase: string;
  onBack: (selectedColor?: string) => void;
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

  // Track which mockup image to show — starts with the canvas snapshot (or
  // the initial colour mockup) and updates to the new colour mockup when the
  // user changes the Colour option.
  const [displayMockupUrl, setDisplayMockupUrl] = useState<string | null>(
    previewUrl ?? mockup?.url ?? null
  );

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

  // Upload preview + print file in the background as soon as the review page
  // opens, so "Add to cart" only has to wait for whatever is left of it.
  type FinalizeResult = { previewUrl?: string; printUrl?: string; designPublicId?: string } | null;
  const finalizeRef = useRef<Promise<FinalizeResult> | null>(null);
  function startFinalize(): Promise<FinalizeResult> {
    finalizeRef.current = finalizeDesign()
      .catch((err) => {
        console.warn("[icy] finalize failed", err);
        return null;
      })
      .then((result) => {
        if (!result) finalizeRef.current = null; // allow a retry on click
        return result;
      });
    return finalizeRef.current;
  }

  /** Uploads the flat preview + print images straight to Blob, then records them. */
  async function finalizeDesign(): Promise<FinalizeResult> {
    const api = `${proxyBase}/api/finalize-design`;
    const post = (payload: object) =>
      proxyFetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, ...payload }),
      });

    const tokRes = await post({ action: "tokens" });
    if (!tokRes.ok) throw new Error(`tokens ${tokRes.status}`);
    const tokens = (await tokRes.json()) as {
      preview: { key: string; clientToken: string };
      print: { key: string; clientToken: string };
    };

    const send = async (dataUrl: string | null, t: { key: string; clientToken: string }, type: string) => {
      if (!dataUrl) return null;
      const blob = await (await fetch(dataUrl)).blob();
      const res = await put(t.key, blob, { access: "public", token: t.clientToken, contentType: type });
      return res.url;
    };
    const [uploadedPreview, uploadedPrint] = await Promise.all([
      send(previewUrl, tokens.preview, "image/jpeg"),
      send(printFileUrl, tokens.print, "image/png"),
    ]);

    const done = await post({ action: "complete", previewUrl: uploadedPreview, printUrl: uploadedPrint });
    if (!done.ok) throw new Error(`complete ${done.status}`);
    return (await done.json()) as FinalizeResult;
  }
  useEffect(() => {
    startFinalize();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function addToCart() {
    if (!selectedVariant || !confirmed) return;
    setAddState("loading");
    setAddError(null);
    try {
      // Step 1: Use the finalize upload that started when this page opened.
      let finalPreviewUrl: string | null = previewUrl;
      let finalPrintUrl: string | null = printFileUrl;
      let designPublicId: string | null = null;
      const data = await (finalizeRef.current ?? startFinalize());
      if (data) {
        finalPreviewUrl = data.previewUrl ?? finalPreviewUrl;
        finalPrintUrl = data.printUrl ?? finalPrintUrl;
        designPublicId = data.designPublicId ?? null;
      }

      // Step 2: Add to Shopify cart with design URLs as line-item properties.
      // Only include URLs that are already on Blob storage — never send raw
      // data: URIs as cart properties because they can be several MB and
      // Shopify will reject the cart add with "Cart is too large".
      const safePreviewUrl = finalPreviewUrl?.startsWith("https://") ? finalPreviewUrl : null;
      const safePrintUrl = finalPrintUrl?.startsWith("https://") ? finalPrintUrl : null;

      // Shopify variant IDs from Admin API are GIDs like
      // "gid://shopify/ProductVariant/12345678". Extract just the numeric part.
      const numericVariantId = Number(selectedVariant.id.replace(/.*\//, ""));

      const res = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              id: numericVariantId,
              quantity: 1,
              properties: {
                _design_id: sessionId,
                ...(designPublicId ? { _design_public_id: designPublicId } : {}),
                _design_color: design.color ?? "",
                ...(safePreviewUrl ? { _design_preview_url: safePreviewUrl } : {}),
                ...(safePrintUrl ? { _design_print_url: safePrintUrl } : {}),
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
        Number(selectedVariant.price)  // Shopify Admin API returns price already in dollars
      )
    : null;

  return (
    <main className="mx-auto max-w-lg p-4 space-y-6">
      {/* Back */}
      <button
        onClick={() => onBack(selectedOptions[product.options.find(o => o.name.toLowerCase() === "color" || o.name.toLowerCase() === "colour")?.name ?? ""] || design.color || undefined)}
        className="flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors"
      >
        <i className="fa-solid fa-arrow-left" />
        Back to editor
      </button>

      <h1 className="text-xl font-semibold">Review your design</h1>

      {/* Design preview — mockup for the selected colour with the design overlay on top */}
      <div className="rounded-xl overflow-hidden border border-border bg-muted/20 relative">
        {displayMockupUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={displayMockupUrl} alt="Product preview" className="w-full object-contain block" />
        )}
        {designOnlyUrl && displayMockupUrl && (
          // Transparent-background design PNG captured from the canvas, overlaid
          // at the same proportions so it aligns with any colour mockup.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={designOnlyUrl} alt="" aria-hidden className="absolute inset-0 w-full h-full object-contain" />
        )}
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
                  onClick={() => {
                    setSelectedOptions((prev) => ({ ...prev, [opt.name]: val }));
                    const lower = opt.name.toLowerCase();
                    if (lower === "color" || lower === "colour") {
                      const newMockup = mockups.find((m) => m.colorName === val);
                      if (newMockup) setDisplayMockupUrl(newMockup.url);
                    }
                  }}
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
            <Button onClick={() => onBack()} className="flex-1">
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
  designOnlyUrl: string | null;
  printFileUrl: string | null;
}

// ---------------------------------------------------------------------------
// Main shell
// ---------------------------------------------------------------------------

export default function CustomizerClient({
  proxyBase,
  productHandle,
  productId,
  logoDataUrl,
}: {
  proxyBase: string;
  productHandle: string | null;
  productId: string | null;
  logoDataUrl?: string;
}) {
  const [bootstrap, setBootstrap] = useState<EditorBootstrap | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Step state
  const [step, setStep] = useState<"editor" | "review">("editor");
  const [reviewPayload, setReviewPayload] = useState<ReviewPayload | null>(null);

  // Preserve the last editor design so Back from Review restores it.
  const [lastEditorState, setLastEditorState] = useState<{
    design: EditorState["design"];
    assets: EditorState["assets"];
    selectedId: null;
  } | null>(null);

  // Track colour the customer selected in Review so the editor can sync it.
  const [reviewSelectedColor, setReviewSelectedColor] = useState<string | null>(null);

  // Store the print file data URL in a ref — it can be 10+ MB as base64 and
  // must NOT go into sessionStorage (5 MB quota). The ref survives re-renders
  // and is written here before the review step is shown.
  const printFileRef = useRef<string | null>(null);

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

  // Always mount Customizer (hidden via CSS during review) so its state and
  // undo/redo history survive the round-trip. ReviewStep is conditionally
  // rendered alongside it — never as an early return that would unmount Customizer.
  return (
    <>
      <div className={step === "review" ? "hidden" : undefined}>
        <Customizer
          bootstrap={bootstrap}
          sessionId={sessionId}
          proxyBase={proxyBase}
          forceColor={reviewSelectedColor}
          logoUrl={logoDataUrl}
          initialState={lastEditorState ?? undefined}
          onClose={() => {
            window.location.href = `/products/${bootstrap.product.handle}`;
          }}
          onContinue={(state: EditorState & { previewUrl?: string | null; designOnlyUrl?: string | null; printFileUrl?: string | null }) => {
            setLastEditorState({ design: state.design, assets: state.assets, selectedId: null });
            // Keep the large print file in a ref — never in sessionStorage.
            printFileRef.current = state.printFileUrl ?? null;
            const payload: ReviewPayload = {
              design: state.design,
              assets: state.assets,
              previewUrl: state.previewUrl ?? null,
              designOnlyUrl: state.designOnlyUrl ?? null,
              printFileUrl: null, // stored in printFileRef, not sessionStorage
            };
            window.sessionStorage.setItem(
              `icy:review:${sessionId}`,
              JSON.stringify(payload)
            );
            window.history.pushState({ step: "review" }, "", `?step=review`);
            window.dispatchEvent(new CustomEvent("icy:continue"));
          }}
        />
      </div>
      {step === "review" && reviewPayload && (
        <ReviewStep
          bootstrap={bootstrap}
          sessionId={sessionId}
          design={reviewPayload.design}
          assets={reviewPayload.assets}
          previewUrl={reviewPayload.previewUrl}
          designOnlyUrl={reviewPayload.designOnlyUrl}
          printFileUrl={printFileRef.current}
          proxyBase={proxyBase}
          onBack={(selectedColor) => {
            if (selectedColor) setReviewSelectedColor(selectedColor);
            window.history.back();
            setStep("editor");
          }}
        />
      )}
    </>
  );
}
