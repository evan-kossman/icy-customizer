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

  // Colour is a tab; sizes are quantity steppers within the active colour.
  const colorOption = product.options.find((o) => /^colou?r$/i.test(o.name)) ?? null;
  const sizeOption = product.options.find((o) => o !== colorOption) ?? null;
  const colorValues = colorOption?.values ?? [""];
  const [activeColor, setActiveColor] = useState<string>(
    colorValues.includes(design.color ?? "") ? (design.color as string) : colorValues[0]
  );
  // variant id -> quantity
  const [qty, setQty] = useState<Record<string, number>>({});

  const variantFor = (color: string, size: string | null): EditorVariant | undefined =>
    product.variants.find((v) =>
      v.selectedOptions.every((o) =>
        colorOption && o.name === colorOption.name ? o.value === color
        : sizeOption && o.name === sizeOption.name ? o.value === size
        : true
      )
    );
  const sizesForColor = (sizeOption?.values ?? [null]).map((size) => ({
    size,
    variant: variantFor(activeColor, size),
  }));
  const countForColor = (color: string) =>
    product.variants
      .filter((v) => !colorOption || v.selectedOptions.some((o) => o.name === colorOption.name && o.value === color))
      .reduce((n, v) => n + (qty[v.id] ?? 0), 0);
  const selectedLines = product.variants
    .filter((v) => (qty[v.id] ?? 0) > 0)
    .map((v) => ({ variant: v, quantity: qty[v.id] }));
  const totalItems = selectedLines.reduce((n, l) => n + l.quantity, 0);
  const totalPrice = selectedLines.reduce((n, l) => n + l.quantity * Number(l.variant.price), 0);
  const money = (n: number) =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(n);

  function setVariantQty(v: EditorVariant, next: number) {
    const cap = v.inventoryQuantity != null && v.inventoryQuantity > 0 ? v.inventoryQuantity : 99;
    setQty((q) => ({ ...q, [v.id]: Math.max(0, Math.min(cap, Math.floor(next) || 0)) }));
  }

  const activeMockup = mockups.find((m) => m.colorName === activeColor) ?? mockup;
  // Plain mockup for the active colour; the transparent design is overlaid on top.
  const displayMockupUrl = activeMockup?.url ?? previewUrl ?? null;

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
  // Set when Add to Cart is pressed before the agreement is ticked.
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const agreementRef = useRef<HTMLLabelElement>(null);
  const [addState, setAddState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [addError, setAddError] = useState<string | null>(null);
  const [addedCount, setAddedCount] = useState(0);

  // Upload preview + print file in the background as soon as the review page
  // opens, so "Add to cart" only has to wait for whatever is left of it.
  type FinalizeResult = { previewUrl?: string; printUrl?: string; designPublicId?: string } | null;
  const finalizeRef = useRef<Promise<FinalizeResult> | null>(null);
  function startFinalize(): Promise<FinalizeResult> {
    const cached = safeGet(sessionStorage, `icy:final:${sessionId}`);
    if (cached && printFileUrl?.startsWith("https://")) {
      finalizeRef.current = Promise.resolve(JSON.parse(cached) as FinalizeResult);
      return finalizeRef.current;
    }
    finalizeRef.current = finalizeDesign()
      .then((result) => {
        if (result) safeSet(sessionStorage, `icy:final:${sessionId}`, JSON.stringify(result));
        return result;
      })
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
    if (!confirmed) {
      setNeedsConfirm(true);
      setShakeKey((k) => k + 1);
      agreementRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      agreementRef.current?.querySelector("input")?.focus({ preventScroll: true });
      return;
    }
    if (!selectedLines.length) {
      setAddError("Choose at least one size.");
      return;
    }
    setAddState("loading");
    setAddError(null);
    try {
      // Step 1: print file (shared by every colour) — uploaded when the page opened.
      const data = await (finalizeRef.current ?? startFinalize());
      const printUrl = data?.printUrl?.startsWith("https://") ? data.printUrl : null;
      const designPublicId = data?.designPublicId ?? null;

      // Step 2: one preview per colour ordered (design composited on that colour).
      const colors = [...new Set(selectedLines.map((l) => colorOf(l.variant)))];
      const previewByColor = await colourPreviews(colors);

      // Step 3: add every size/colour line in a single cart request.
      const res = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: selectedLines.map(({ variant, quantity }) => {
            const color = colorOf(variant);
            const preview = previewByColor[color] ?? null;
            return {
              id: Number(variant.id.replace(/.*\//, "")),
              quantity,
              properties: {
                _design_id: sessionId,
                ...(designPublicId ? { _design_public_id: designPublicId } : {}),
                _design_color: color,
                ...(preview ? { _design_preview_url: preview } : {}),
                ...(printUrl ? { _design_print_url: printUrl } : {}),
              },
            };
          }),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.description ?? "Could not add to cart.");
      }
      setAddedCount((n) => n + totalItems);
      setQty({});
      setAddState("success");
      // The design is in the cart — a refresh or next visit starts fresh.
      safeRemove(localStorage, sessionKey(product.id));
      safeRemove(localStorage, `icy:state:${sessionId}`);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Something went wrong.");
      setAddState("error");
    }
  }

  function colorOf(v: EditorVariant): string {
    return (colorOption && v.selectedOptions.find((o) => o.name === colorOption.name)?.value) || design.color || "";
  }

  // Composite the transparent design over each colour's mockup and upload it,
  // so the cart shows the right colour. Cached per colour for repeat adds.
  const previewCache = useRef<Record<string, string>>({});
  async function colourPreviews(colors: string[]): Promise<Record<string, string>> {
    const missing = colors.filter((c) => !previewCache.current[c]);
    if (missing.length && designOnlyUrl) {
      try {
        const tokRes = await proxyFetch(`${proxyBase}/api/finalize-design`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, action: "preview-tokens", count: missing.length }),
        });
        if (!tokRes.ok) throw new Error(`preview tokens ${tokRes.status}`);
        const { previews } = (await tokRes.json()) as { previews: { key: string; clientToken: string }[] };
        const design = await loadImage(designOnlyUrl);
        await Promise.all(
          missing.map(async (color, i) => {
            const m = mockups.find((mm) => mm.colorName === color);
            if (!m) return;
            const shirt = await loadImage(m.url);
            const W = Math.min(shirt.naturalWidth, 1200);
            const H = Math.round((W * shirt.naturalHeight) / shirt.naturalWidth);
            const canvas = document.createElement("canvas");
            canvas.width = W;
            canvas.height = H;
            const ctx = canvas.getContext("2d")!;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, W, H);
            ctx.drawImage(shirt, 0, 0, W, H);
            ctx.drawImage(design, 0, 0, W, H);
            const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
            if (!blob) return;
            const t = previews[i];
            const up = await put(t.key, blob, { access: "public", token: t.clientToken, contentType: "image/jpeg" });
            previewCache.current[color] = up.url;
          })
        );
      } catch (err) {
        console.warn("[icy] colour previews failed", err);
      }
    }
    // Fallback: the editor snapshot, for the colour it was taken in.
    const out: Record<string, string> = {};
    for (const c of colors) {
      const url = previewCache.current[c];
      if (url) out[c] = url;
    }
    return out;
  }

  return (
    <main className="mx-auto max-w-lg p-4 space-y-6">
      {/* Back */}
      <button
        onClick={() => onBack(activeColor || design.color || undefined)}
        className="flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors"
      >
        <i className="fa-solid fa-arrow-left" />
        Back to editor
      </button>

      <h1 className="icy-heading">Review your design</h1>

      {/* Design preview — mockup for the selected colour with the design overlay on top */}
      <div className="rounded-xl overflow-hidden border border-border bg-white relative">
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

      {/* Colour tabs */}
      {colorOption && (
        <div className="space-y-2">
          <h2 className="icy-heading" style={{ fontSize: "1.1rem" }}>Choose colours and sizes</h2>
          <div className="flex flex-wrap gap-2">
            {colorValues.map((color) => {
              const m = mockups.find((mm) => mm.colorName === color);
              const count = countForColor(color);
              const active = color === activeColor;
              return (
                <button
                  key={color}
                  type="button"
                  onClick={() => setActiveColor(color)}
                  title={color}
                  aria-label={`${color}${count ? `, ${count} selected` : ""}`}
                  aria-pressed={active}
                  className={`relative h-16 w-16 rounded-lg border-2 bg-white p-1 transition-colors ${
                    active ? "border-accent" : "border-transparent hover:border-line"
                  }`}
                >
                  {m ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <span className="text-xs">{color}</span>
                  )}
                  {count > 0 && (
                    <span className="absolute -right-2 -top-2 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-semibold text-white">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-sm text-muted">{activeColor}</p>
        </div>
      )}

      {/* Size quantities for the active colour */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {sizesForColor.map(({ size, variant }) => {
          const n = variant ? qty[variant.id] ?? 0 : 0;
          const soldOut = !variant || !variant.availableForSale;
          const left = variant?.inventoryQuantity;
          return (
            <div
              key={size ?? "one"}
              className={`flex items-center justify-between gap-2 rounded-xl border-2 p-3 ${
                n > 0 ? "border-accent bg-accent/5" : "border-transparent"
              } ${soldOut ? "opacity-50" : ""}`}
            >
              <div>
                <p className="font-semibold">{size ?? "One size"}</p>
                <p className="text-sm text-muted">
                  {soldOut ? "Sold out" : variant ? money(Number(variant.price)) : ""}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={soldOut || n === 0}
                    onClick={() => variant && setVariantQty(variant, n - 1)}
                    className="grid h-9 w-9 place-items-center rounded-lg bg-canvas disabled:opacity-40"
                    aria-label={`Fewer ${size ?? ""}`}
                  >
                    <i className="fa-solid fa-minus text-xs" />
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={n}
                    disabled={soldOut}
                    onChange={(e) => variant && setVariantQty(variant, Number(e.target.value))}
                    className="h-9 w-12 rounded-lg border border-line text-center"
                    aria-label={`Quantity ${size ?? ""}`}
                  />
                  <button
                    type="button"
                    disabled={soldOut}
                    onClick={() => variant && setVariantQty(variant, n + 1)}
                    className="grid h-9 w-9 place-items-center rounded-lg bg-canvas disabled:opacity-40"
                    aria-label={`More ${size ?? ""}`}
                  >
                    <i className="fa-solid fa-plus text-xs" />
                  </button>
                </div>
                {n > 0 && left != null && left > 0 && left <= 20 && (
                  <span className="text-xs text-accent">{left} left</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Totals */}
      <div className="space-y-1 border-t border-line pt-3">
        <div className="flex justify-between text-sm">
          <span>Items:</span>
          <span>{totalItems}</span>
        </div>
        <div className="flex justify-between text-lg font-bold">
          <span>Total:</span>
          <span>{money(totalPrice)}</span>
        </div>
      </div>

      {/* Low-quality image warning */}
      {lowQualityImages.length > 0 && (
        <Alert tone="warning">
          One or more of your images may print at lower quality. For best results, upload images
          at least 300 DPI at their printed size.
        </Alert>
      )}

      {/* Confirmation checkbox */}
      {(
        <div>
          <label
            key={shakeKey}
            ref={agreementRef}
            className={`flex items-start gap-3 rounded-xl border-2 p-4 cursor-pointer transition-colors ${
              confirmed
                ? "border-primary bg-primary/5"
                : needsConfirm
                  ? "border-red-600 bg-red-50 icy-shake"
                  : "border-border"
            }`}
          >
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => {
                setConfirmed(e.target.checked);
                if (e.target.checked) setNeedsConfirm(false);
              }}
              aria-invalid={needsConfirm && !confirmed}
              className="mt-1 h-5 w-5 shrink-0 rounded accent-primary"
            />
            <span className="icy-heading" style={{ fontSize: "1.1rem", lineHeight: 1.25 }}>
              I own or have permission to use this artwork, and I authorize Icy to print it.
            </span>
          </label>
        </div>
      )}

      {/* Add to cart — customers can add more sizes/colours as many times as they like */}
      {addError && <Alert tone="error">{addError}</Alert>}
      {addState === "success" && addedCount > 0 && (
        <Alert tone="info">
          {addedCount} item{addedCount === 1 ? "" : "s"} added to your cart.{" "}
          <a href="/cart" className="font-semibold underline">View cart</a>
        </Alert>
      )}
      <Button
        onClick={addToCart}
        disabled={totalItems === 0 || addState === "loading"}
        className="w-full"
      >
        {addState === "loading" ? "Adding…" : "Add to Cart"}
      </Button>
    </main>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

// ---------------------------------------------------------------------------
// Storage helpers (never throw — storage can be blocked in private mode)
// ---------------------------------------------------------------------------

const sessionKey = (productGid: string) => `icy:session:${productGid}`;
function safeGet(store: Storage, key: string): string | null {
  try { return store.getItem(key); } catch { return null; }
}
function safeSet(store: Storage, key: string, value: string) {
  try { store.setItem(key, value); } catch { /* ignore */ }
}
function safeRemove(store: Storage, key: string) {
  try { store.removeItem(key); } catch { /* ignore */ }
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

  /** Returns the stored session for this product if it's still an open draft. */
  async function resumeSession(productGid: string): Promise<{
    sessionId: string;
    editorState: { design: EditorState["design"]; assets: EditorState["assets"]; selectedId: null } | null;
    review: ReviewPayload | null;
  } | null> {
    const stored = safeGet(localStorage, sessionKey(productGid));
    if (!stored) return null;
    try {
      const res = await proxyFetch(`${proxyBase}/api/session/${stored}`);
      if (!res.ok) throw new Error();
      const s = (await res.json()) as { status: string; expiresAt: string };
      // "in_cart" is set when the review page uploads the print file, before
      // anything is actually added — so it's still resumable.
      if (!["draft", "in_cart"].includes(s.status) || new Date(s.expiresAt).getTime() < Date.now()) throw new Error();
    } catch {
      safeRemove(localStorage, sessionKey(productGid));
      return null;
    }

    let editorState = null;
    try {
      const raw = safeGet(localStorage, `icy:state:${stored}`);
      if (raw) {
        const saved = JSON.parse(raw) as { design: EditorState["design"]; assets: EditorState["assets"] };
        editorState = { design: saved.design, assets: saved.assets, selectedId: null as null };
      }
    } catch { /* ignore */ }

    // Restore the review step only if its images were already uploaded —
    // otherwise drop back to the editor (the design itself is never lost).
    let review: ReviewPayload | null = null;
    if (new URLSearchParams(window.location.search).get("step") === "review") {
      try {
        const raw = safeGet(sessionStorage, `icy:review:${stored}`);
        const fin = safeGet(sessionStorage, `icy:final:${stored}`);
        if (raw && fin) {
          const payload = JSON.parse(raw) as ReviewPayload;
          const done = JSON.parse(fin) as { previewUrl?: string; printUrl?: string };
          if (done.printUrl) {
            review = { ...payload, previewUrl: done.previewUrl ?? payload.previewUrl, printFileUrl: done.printUrl };
          }
        }
      } catch { /* ignore */ }
    }
    return { sessionId: stored, editorState, review };
  }

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

        // Resume this browser's in-progress design for this product, if any.
        const resumed = await resumeSession(config.product.id);
        let id = resumed?.sessionId ?? null;
        if (!id) {
          const sessionRes = await proxyFetch(`${proxyBase}/api/session`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productId: config.product.id }),
          });
          if (!sessionRes.ok) throw new Error("Could not start a design session.");
          id = ((await sessionRes.json()) as { sessionId: string }).sessionId;
          safeSet(localStorage, sessionKey(config.product.id), id);
        }

        if (!cancelled) {
          if (resumed?.editorState) setLastEditorState(resumed.editorState);
          setBootstrap(config);
          setSessionId(id);
          if (resumed?.review) {
            printFileRef.current = resumed.review.printFileUrl;
            setReviewPayload(resumed.review);
            setStep("review");
          }
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
            // New capture — any earlier uploaded images are stale.
            safeRemove(sessionStorage, `icy:final:${sessionId}`);
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
            const url = new URL(window.location.href);
            url.searchParams.set("step", "review");
            window.history.pushState({ step: "review" }, "", url.toString());
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
