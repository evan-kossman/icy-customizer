"use client";
import { proxyFetch } from "@/lib/client-token";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  emptyDesign,
  hasOverflow,
  type DesignObject,
  type ImageObject,
  type TextObject,
} from "@/lib/design";
import type { EditorAsset, EditorBootstrap, EditorState } from "@/lib/editor/types";
import { newObjectId } from "@/lib/editor/reducer";
import {
  useAutosave,
  useCanvasGeometry,
  useEditorState,
  useElementWidth,
  useUnloadGuard,
} from "@/lib/editor/use-editor";
import { useImage, useImages, readImageFile } from "@/lib/editor/use-images";
import { removeBackground, uploadImage } from "@/lib/editor/upload";
import { Button, IconButton, Alert } from "./ui";
import UploadPanel from "./panels/UploadPanel";
import TextPanel from "./panels/TextPanel";
import LayersPanel from "./panels/LayersPanel";
import ColorPanel from "./panels/ColorPanel";
import StickerPanel, { type StickerItem } from "./panels/StickerPanel";
import AiPanel from "./panels/AiPanel";

// Konva touches window at import time, so the canvas is client-only and
// lazily loaded — it is also the heaviest chunk in the bundle.
const CanvasStage = dynamic(() => import("./CanvasStage"), {
  ssr: false,
  loading: () => (
    <div className="grid aspect-[4/5] w-full place-items-center rounded-card bg-canvas text-sm text-muted">
      Loading editor…
    </div>
  ),
});

interface Props {
  bootstrap: EditorBootstrap;
  sessionId: string;
  proxyBase: string;
  initialState?: EditorState;
  /** When set, syncs the colour picker to this value (used when Back from Review changes colour). */
  forceColor?: string | null;
  /** Base64 data URL for the header logo. */
  logoUrl?: string;
  onContinue: (state: EditorState) => void;
  onClose: () => void;
}

export default function Customizer({
  bootstrap,
  sessionId,
  proxyBase,
  initialState,
  forceColor,
  logoUrl,
  onContinue,
  onClose,
}: Props) {
  const { config, mockups, fonts, product, customer } = bootstrap;

  const [state, setState] = useState<EditorState>(
    () =>
      initialState ?? {
        design: {
          ...emptyDesign(product.id, config.id, config.printArea),
          color: mockups[0]?.colorName ?? null,
        },
        assets: {},
        selectedId: null,
      }
  );

  // Sync colour changes that originated in the Review step back into the editor.
  useEffect(() => {
    if (!forceColor || forceColor === current.design.color) return;
    const mockup = mockups.find((m) => m.colorName === forceColor);
    dispatch({ type: "set-color", color: forceColor, variantId: mockup?.shopifyVariantId ?? null });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceColor]);

  const editor = useEditorState(state);
  const { dispatch, beginGesture, undo, redo, canUndo, canRedo, version } = editor;
  const current = editor.state;

  useEffect(() => setState(current), [current]);

  const [zoomedIn, setZoomedIn] = useState(false);
  const stageRef = useRef<import("konva/lib/Stage").Stage | null>(null);

  /**
   * Capture a JPEG preview of the current canvas and pass it to the caller
   * alongside the design state so the review step can display the design.
   */
  // Ref to hold a pending "continue" action that fires after zoom resets.
  const pendingContinueRef = useRef<EditorState | null>(null);

  function captureAndContinue(editorState: EditorState) {
    // Deselect everything so transformer handles don't appear in the preview.
    // If something is selected, we must wait one rAF for Konva to redraw before capturing.
    if (editorState.selectedId) {
      dispatch({ type: "select", id: null as unknown as string });
      const pendingState = { ...editorState, selectedId: null };
      requestAnimationFrame(() => doCapture(pendingState));
      return;
    }
    doCapture(editorState);
  }

  function doCapture(editorState: EditorState) {
    let previewUrl: string | null = null;
    let designOnlyUrl: string | null = null;
    let printFileUrl: string | null = null;
    try {
      // Full preview: shirt + design baked together.
      // Hide the dotted print-area guide so previews show the finished garment.
      const guide = stageRef.current?.findOne(".print-area-border");
      guide?.visible(false);
      guide?.getLayer()?.batchDraw();

      const dataUrl = stageRef.current?.toDataURL({
        mimeType: "image/jpeg",
        quality: 0.8,
        pixelRatio: 1.5,
      });
      previewUrl = dataUrl ?? null;

      // Design-only: transparent PNG (low-res, for review overlay).
      // Print file: design-only clipped to the print area at full 300 DPI.
      const layers = stageRef.current?.getLayers();
      const bgLayer = layers?.[0];
      if (bgLayer) {
        bgLayer.opacity(0);
        bgLayer.batchDraw();

        // Low-res overlay (for review UI)
        designOnlyUrl = stageRef.current?.toDataURL({ mimeType: "image/png", pixelRatio: 1.5 }) ?? null;

        // High-res print file — clipped to print area at true 300-DPI resolution
        const printPixelRatio = geometry.printWidth > 0
          ? config.printArea.widthPx / geometry.printWidth
          : 1;
        printFileUrl = stageRef.current?.toDataURL({
          mimeType: "image/png",
          pixelRatio: printPixelRatio,
          x: geometry.printLeft,
          y: geometry.printTop,
          width: geometry.printWidth,
          height: geometry.printHeight,
        }) ?? null;

        bgLayer.opacity(1);
        bgLayer.batchDraw();
      }
      if (guide) {
        guide.visible(true);
        guide.getLayer()?.batchDraw();
      }
    } catch {
      /* canvas might be tainted by cross-origin assets — skip preview */
    }
    onContinue({
      ...editorState,
      selectedId: null,  // never carry selection into review
      previewUrl,
      designOnlyUrl,
      printFileUrl,
    } as EditorState & { previewUrl: string | null; designOnlyUrl: string | null; printFileUrl: string | null });
  }

  // Always transition to review at zoom-out so the preview shows the full shirt.
  // If already zoomed out, capture immediately. Otherwise reset zoom and wait
  // one animation frame for Konva to redraw before capturing.
  function continueWithPreview(editorState: EditorState) {
    if (!zoomedIn) {
      captureAndContinue(editorState);
      return;
    }
    pendingContinueRef.current = editorState;
    setZoomedIn(false);
  }

  // Fire the deferred capture once zoom has been reset and the canvas redrawn.
  useEffect(() => {
    if (zoomedIn || !pendingContinueRef.current) return;
    const pending = pendingContinueRef.current;
    pendingContinueRef.current = null;
    // One rAF to let Konva finish its synchronous redraw after the zoom change.
    const raf = requestAnimationFrame(() => doCapture(pending));
    return () => cancelAnimationFrame(raf);
  }, [zoomedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // BG removal defaults OFF — user must opt in (#10)
  const [bgRemovalOn, setBgRemovalOn] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);

  const activeMockup = useMemo(
    () => mockups.find((m) => m.colorName === current.design.color) ?? mockups[0] ?? null,
    [mockups, current.design.color]
  );

  const [containerRef, containerWidth] = useElementWidth<HTMLDivElement>();
  const mockupImage = useImage(activeMockup?.url ?? null);
  const images = useImages(current.assets);

  const geometry = useCanvasGeometry({
    displayWidth: Math.max(containerWidth, 1),
    mockupAspect: activeMockup ? activeMockup.height / activeMockup.width : 1.25,
    printAreaFraction: activeMockup?.printArea ?? {
      x: 0.25,
      y: 0.22,
      width: 0.5,
      height: 0.5,
    },
    printWidthPx: config.printArea.widthPx,
  });

  // Two-level zoom: out = full shirt (1×), in = print area fills the viewport.
  // Fit the whole print area (width AND height) with a small margin.
  const zoom = zoomedIn
    ? Math.floor(
        Math.min(
          geometry.displayWidth / Math.max(geometry.printWidth, 1),
          geometry.displayHeight / Math.max(geometry.printHeight, 1)
        ) * 0.92 * 100
      ) / 100
    : 1;

  const saveStatus = useAutosave({
    sessionId,
    design: current.design,
    version,
    enabled: true,
    proxyBase,
  });

  useUnloadGuard(current.design.objects.length > 0 && saveStatus !== "saved");

  // Fetch the authoritative credit balance; the display never drives spending.
  useEffect(() => {
    if (!config.features.ai || !customer.loggedIn) return;
    proxyFetch(`${proxyBase}/api/ai-credits`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCredits(d.remaining))
      .catch(() => setCredits(null));
  }, [config.features.ai, customer.loggedIn, proxyBase]);

  const selected = current.design.objects.find((o) => o.id === current.selectedId) ?? null;

  // -------------------------------------------------------------------------
  // Object helpers
  // -------------------------------------------------------------------------

  const centreOfPrint = useCallback(
    () => ({
      x: config.printArea.widthPx / 2,
      y: config.printArea.heightPx / 2,
    }),
    [config.printArea]
  );

  /** Scales a new image so it occupies a sensible share of the print area. */
  const fitToPrintArea = useCallback(
    (width: number, height: number) => {
      const maxWidth = config.printArea.widthPx * 0.6;
      const maxHeight = config.printArea.heightPx * 0.6;
      const scale = Math.min(maxWidth / width, maxHeight / height, 1);
      return { width: width * scale, height: height * scale };
    },
    [config.printArea]
  );

  const addImageObject = useCallback(
    (asset: EditorAsset, type: "image" | "ai-image" | "sticker", originalAssetId?: string) => {
      const fitted = fitToPrintArea(asset.width, asset.height);
      const centre = centreOfPrint();

      const object: ImageObject = {
        id: newObjectId(),
        type,
        assetId: asset.id,
        originalAssetId,
        backgroundRemoved: asset.kind === "background_removed",
        sourceWidth: asset.width,
        sourceHeight: asset.height,
        x: centre.x,
        y: centre.y,
        width: fitted.width,
        height: fitted.height,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        zIndex: 0,
        visible: true,
        locked: false,
      };

      dispatch({ type: "add-object", object });
    },
    [centreOfPrint, dispatch, fitToPrintArea]
  );

  // -------------------------------------------------------------------------
  // Upload flow
  // -------------------------------------------------------------------------

  const handleFiles = useCallback(
    async (files: File[]) => {
      setUploadBusy(true);
      setUploadError(null);

      for (const file of files) {
        try {
          const { url: localUrl, width, height } = await readImageFile(file);

          // Show the image immediately from the local object URL; the upload
          // continues in the background so the customer is never blocked.
          const uploaded = await uploadImage({
            proxyBase,
            sessionId,
            file,
            width,
            height,
          });
          URL.revokeObjectURL(localUrl);

          const asset: EditorAsset = {
            id: uploaded.assetId,
            url: uploaded.url,
            width: uploaded.width,
            height: uploaded.height,
            kind: "upload",
          };
          dispatch({ type: "add-asset", asset });

          if (bgRemovalOn && config.features.backgroundRemoval) {
            dispatch({ type: "update-asset", id: asset.id, patch: { pending: true } });
            try {
              const processed = await removeBackground({
                proxyBase,
                sessionId,
                assetId: asset.id,
              });
              const processedAsset: EditorAsset = {
                id: processed.assetId,
                url: processed.url,
                width: processed.width,
                height: processed.height,
                kind: "background_removed",
                parentId: asset.id,
              };
              dispatch({ type: "add-asset", asset: processedAsset });
              dispatch({ type: "update-asset", id: asset.id, patch: { pending: false } });
              addImageObject(processedAsset, "image", asset.id);
            } catch (err) {
              // Background removal is non-fatal: keep the original usable.
              dispatch({
                type: "update-asset",
                id: asset.id,
                patch: {
                  pending: false,
                  error: err instanceof Error ? err.message : undefined,
                },
              });
              setUploadError(
                err instanceof Error
                  ? err.message
                  : "Background removal couldn't be completed. Your original image is still available."
              );
              addImageObject(asset, "image");
            }
          } else {
            addImageObject(asset, "image");
          }
        } catch (err) {
          setUploadError(
            err instanceof Error ? err.message : "Unable to upload this image. Please try again."
          );
        }
      }

      setUploadBusy(false);
    },
    [addImageObject, bgRemovalOn, config.features.backgroundRemoval, dispatch, proxyBase, sessionId]
  );

  /** Swaps an image object between its original and background-removed asset. */
  const toggleObjectBackground = useCallback(
    (objectId: string, useRemoved: boolean) => {
      const object = current.design.objects.find((o) => o.id === objectId) as ImageObject | undefined;
      if (!object) return;

      const removed = Object.values(current.assets).find(
        (a) => a.parentId === (object.originalAssetId ?? object.assetId)
      );
      const originalId = object.originalAssetId ?? object.assetId;

      if (useRemoved && removed) {
        dispatch({
          type: "update-object",
          id: objectId,
          patch: { assetId: removed.id, originalAssetId: originalId, backgroundRemoved: true },
        });
      } else {
        dispatch({
          type: "update-object",
          id: objectId,
          patch: { assetId: originalId, backgroundRemoved: false },
        });
      }
    },
    [current.assets, current.design.objects, dispatch]
  );

  // -------------------------------------------------------------------------
  // Text and stickers
  // -------------------------------------------------------------------------

  const addText = useCallback(() => {
    const centre = centreOfPrint();
    const fontSize = 225; // default size; +/- in the text panel ranges 20–400

    // Auto-pick legible default fill: white on dark shirts, black on light ones.
    const currentMockup = mockups.find((m) => m.colorName === current.design.color) ?? mockups[0];
    const defaultFill = (() => {
      const hex = currentMockup?.colorHex ?? "#ffffff";
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return luminance < 0.5 ? "#ffffff" : "#111111";
    })();

    const object: TextObject = {
      id: newObjectId(),
      type: "text",
      text: "Your text",
      fontFamily: fonts[0]?.family ?? "Inter",
      fontSize,
      fontWeight: 700,
      italic: false,
      underline: false,
      uppercase: false,
      fill: defaultFill,
      align: "center",
      letterSpacing: 0,
      lineHeight: 1.2,
      x: centre.x,
      y: centre.y,
      width: config.printArea.widthPx * 0.8,
      height: fontSize * 1.2,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      zIndex: 0,
      visible: true,
      locked: false,
    };

    dispatch({ type: "add-object", object });
  }, [centreOfPrint, config.printArea, dispatch, fonts]);

  const addSticker = useCallback(
    (sticker: StickerItem) => {
      const asset: EditorAsset = {
        id: sticker.id,
        url: sticker.url,
        width: sticker.width,
        height: sticker.height,
        kind: "sticker",
      };
      dispatch({ type: "add-asset", asset });
      addImageObject(asset, "sticker");
    },
    [addImageObject, dispatch]
  );

  // -------------------------------------------------------------------------
  // Alignment helpers
  // -------------------------------------------------------------------------

  const handleCenter = useCallback(
    (id: string, axis: "both" | "horizontal" | "vertical") => {
      const centre = centreOfPrint();
      const patch: Partial<DesignObject> = {};
      if (axis === "horizontal" || axis === "both") patch.x = centre.x;
      if (axis === "vertical" || axis === "both") patch.y = centre.y;
      dispatch({ type: "update-object", id, patch });
    },
    [centreOfPrint, dispatch]
  );

  // -------------------------------------------------------------------------
  // Keyboard shortcuts
  // -------------------------------------------------------------------------

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, select")) return;

      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if ((event.key === "Delete" || event.key === "Backspace") && current.selectedId) {
        event.preventDefault();
        dispatch({ type: "remove-object", id: current.selectedId });
      } else if (event.key === "Escape") {
        dispatch({ type: "select", id: null });
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current.selectedId, dispatch, redo, undo]);

  const overflow = hasOverflow(current.design);
  const canContinue = current.design.objects.some((o) => o.visible);

  const saveLabel = {
    idle: "",
    saving: "Saving design…",
    saved: "Saved",
    "local-only": "Saved on this device — we'll retry syncing",
    error: "Could not save",
  }[saveStatus];

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3" style={{ background: "#171717" }}>
        <button
          onClick={onClose}
          aria-label="Close customizer"
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logoUrl && <img src={logoUrl} alt="Icy" className="h-8 w-auto" />}
        </div>
        <span className="hidden text-xs text-white/50 sm:block" aria-live="polite">
          {saveLabel}
        </span>
      </header>

      <div className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[1fr_380px] lg:h-[calc(100vh-53px)] lg:overflow-hidden">
        {/* Canvas */}
        <div className="space-y-3 lg:overflow-y-auto lg:pb-4">
          <div className="rounded-card border border-line bg-surface p-3">
            <div ref={containerRef} className="mx-auto w-full max-w-[560px] lg:max-w-[420px] xl:max-w-[480px] overflow-hidden">
              {containerWidth > 0 && (
                <CanvasStage
                  objects={current.design.objects}
                  assets={current.assets}
                  images={images}
                  mockupImage={mockupImage}
                  geometry={geometry}
                  selectedId={current.selectedId}
                  zoom={zoom}
                  stageRef={stageRef}
                  onSelect={(id) => dispatch({ type: "select", id })}
                  onChange={(id, patch, transient) =>
                    dispatch({ type: "update-object", id, patch }, { transient })
                  }
                  onGestureStart={beginGesture}
                />
              )}
            </div>

            {/* Toolbar — Font Awesome icons via CDN */}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              {/* Undo / Redo — standard FA icons (#1) */}
              <IconButton label="Undo" onClick={undo} disabled={!canUndo}>
                <i className="fa-solid fa-rotate-left" />
              </IconButton>
              <IconButton label="Redo" onClick={redo} disabled={!canRedo}>
                <i className="fa-solid fa-rotate-right" />
              </IconButton>

              <span className="h-5 w-px bg-line" aria-hidden />

              {/* Zoom toggle — two levels only: full shirt or print-area fill */}
              <IconButton
                label={zoomedIn ? "Zoom out (show full shirt)" : "Zoom in (fill print area)"}
                onClick={() => setZoomedIn((z) => !z)}
              >
                <i className={`fa-solid ${zoomedIn ? "fa-magnifying-glass-minus" : "fa-magnifying-glass-plus"}`} />
              </IconButton>

            </div>

          </div>

          {overflow && (
            <Alert>
              Part of your design sits outside the dotted print area. Anything outside it
              won&apos;t be printed.
            </Alert>
          )}


        </div>

        {/* Controls */}
        <div className="flex flex-col lg:overflow-hidden lg:h-full">
        <div className="flex-1 space-y-4 overflow-y-auto pb-4">
          <ColorPanel
            mockups={mockups}
            selectedColor={current.design.color}
            onSelect={(colorName) => {
              const mockup = mockups.find((m) => m.colorName === colorName);
              dispatch({
                type: "set-color",
                color: colorName,
                variantId: mockup?.shopifyVariantId ?? null,
              });
            }}
          />

          <UploadPanel
            assets={Object.values(current.assets)}
            objects={current.design.objects.filter((o) => o.type !== "text") as ImageObject[]}
            printArea={config.printArea}
            maxUploads={config.maxUploads}
            maxBytes={config.maxUploadBytes}
            backgroundRemovalEnabled={config.features.backgroundRemoval}
            backgroundRemovalOn={bgRemovalOn}
            onToggleBackgroundRemoval={setBgRemovalOn}
            onFiles={handleFiles}
            onRemove={(assetId) => dispatch({ type: "remove-asset", id: assetId })}
            onSelect={(id) => dispatch({ type: "select", id })}
            onToggleObjectBackground={toggleObjectBackground}
            busy={uploadBusy}
            error={uploadError}
          />

          {config.features.ai && (
            <AiPanel
              proxyBase={proxyBase}
              sessionId={sessionId}
              loggedIn={customer.loggedIn}
              creditsRemaining={credits}
              creditsTotal={config.aiCredits}
              onGenerated={(result) => {
                const asset: EditorAsset = {
                  id: result.assetId,
                  url: result.url,
                  width: result.width,
                  height: result.height,
                  kind: "ai_generated",
                };
                dispatch({ type: "add-asset", asset });
                addImageObject(asset, "ai-image");
              }}
              onCreditsChanged={setCredits}
            />
          )}

          {config.features.text && (
            <TextPanel
              fonts={fonts}
              selectedId={current.selectedId}
              onAdd={addText}
              onSelect={(id) => dispatch({ type: "select", id })}
              onUpdate={(id, patch) =>
                dispatch({ type: "update-object", id, patch: patch as Partial<DesignObject> })
              }
              onDelete={(id) => dispatch({ type: "remove-object", id })}
              textObjects={current.design.objects.filter((o) => o.type === "text") as TextObject[]}
            />
          )}

          {config.features.stickers && (
            <StickerPanel
              proxyBase={proxyBase}
              categories={config.stickerCategories}
              onAdd={addSticker}
            />
          )}

          <LayersPanel
            objects={current.design.objects}
            selectedId={current.selectedId}
            maxUploads={config.maxUploads}
            onSelect={(id) => dispatch({ type: "select", id })}
            onReorder={(id, direction) => dispatch({ type: "reorder", id, direction })}
            onUpdate={(id, patch) => dispatch({ type: "update-object", id, patch })}
            onDuplicate={(id) => dispatch({ type: "duplicate-object", id })}
            onDelete={(id) => dispatch({ type: "remove-object", id })}
            onCenter={handleCenter}
          />


        </div>

          {/* Continue — full-width, sticks to the bottom of the right column */}
          <div className="pt-3 pb-2 bg-white border-t border-line mt-auto">
            <Button
              variant="primary"
              className="w-full"
              disabled={!canContinue}
              onClick={() => continueWithPreview(current)}
            >
              Continue
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
