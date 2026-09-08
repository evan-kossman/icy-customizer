"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  onContinue: (state: EditorState) => void;
  onClose: () => void;
}

export default function Customizer({
  bootstrap,
  sessionId,
  proxyBase,
  initialState,
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

  const editor = useEditorState(state);
  const { dispatch, beginGesture, undo, redo, canUndo, canRedo, version } = editor;
  const current = editor.state;

  useEffect(() => setState(current), [current]);

  const [zoom, setZoom] = useState(1);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [bgRemovalOn, setBgRemovalOn] = useState(config.features.backgroundRemoval);
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
    fetch(`${proxyBase}/api/ai-credits`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCredits(d.remaining))
      .catch(() => setCredits(null));
  }, [config.features.ai, customer.loggedIn, proxyBase]);

  const selected = current.design.objects.find((o) => o.id === current.selectedId) ?? null;
  const selectedText = selected?.type === "text" ? (selected as TextObject) : null;

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
                "Background removal couldn't be completed. Your original image is still available."
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
    const fontSize = Math.round(config.printArea.dpi * 0.75); // ~0.75in cap height

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
      fill: "#111111",
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
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
        <button onClick={onClose} className="text-sm text-muted hover:text-ink" aria-label="Close customizer">
          ← Back
        </button>
        <h1 className="truncate text-sm font-semibold">{product.title}</h1>
        <span className="hidden text-xs text-muted sm:block" aria-live="polite">
          {saveLabel}
        </span>
      </header>

      <div className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[1fr_380px]">
        {/* Canvas */}
        <div className="space-y-3">
          <div className="rounded-card border border-line bg-surface p-3">
            <div ref={containerRef} className="mx-auto w-full max-w-[560px] overflow-hidden">
              {containerWidth > 0 && (
                <CanvasStage
                  objects={current.design.objects}
                  assets={current.assets}
                  images={images}
                  mockupImage={mockupImage}
                  geometry={geometry}
                  selectedId={current.selectedId}
                  zoom={zoom}
                  onSelect={(id) => dispatch({ type: "select", id })}
                  onChange={(id, patch, transient) =>
                    dispatch({ type: "update-object", id, patch }, { transient })
                  }
                  onGestureStart={beginGesture}
                />
              )}
            </div>

            {/* Toolbar */}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <IconButton label="Undo" onClick={undo} disabled={!canUndo}>↶</IconButton>
              <IconButton label="Redo" onClick={redo} disabled={!canRedo}>↷</IconButton>
              <IconButton label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>−</IconButton>
              <span className="min-w-[3rem] text-center text-xs text-muted">{Math.round(zoom * 100)}%</span>
              <IconButton label="Zoom in" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>+</IconButton>
              <IconButton label="Reset zoom" onClick={() => setZoom(1)}>⤢</IconButton>
              <IconButton
                label="Centre horizontally"
                disabled={!current.selectedId}
                onClick={() =>
                  current.selectedId &&
                  dispatch({ type: "center", id: current.selectedId, axis: "horizontal" })
                }
              >
                ⇔
              </IconButton>
              <IconButton
                label="Centre vertically"
                disabled={!current.selectedId}
                onClick={() =>
                  current.selectedId &&
                  dispatch({ type: "center", id: current.selectedId, axis: "vertical" })
                }
              >
                ⇕
              </IconButton>
            </div>

            {overflow && (
              <div className="mt-3">
                <Alert>
                  Part of your design sits outside the dotted print area. Anything outside it
                  won&apos;t be printed.
                </Alert>
              </div>
            )}
          </div>

          <Button
            variant="primary"
            className="w-full lg:hidden"
            disabled={!canContinue}
            onClick={() => onContinue(current)}
          >
            Continue
          </Button>
        </div>

        {/* Controls */}
        <div className="space-y-4">
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
              selected={selectedText}
              printDpi={config.printArea.dpi}
              onAdd={addText}
              onChange={(patch) =>
                current.selectedId &&
                dispatch({
                  type: "update-object",
                  id: current.selectedId,
                  patch: patch as Partial<DesignObject>,
                })
              }
              onDelete={() =>
                current.selectedId && dispatch({ type: "remove-object", id: current.selectedId })
              }
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
            onSelect={(id) => dispatch({ type: "select", id })}
            onReorder={(id, direction) => dispatch({ type: "reorder", id, direction })}
            onUpdate={(id, patch) => dispatch({ type: "update-object", id, patch })}
            onDuplicate={(id) => dispatch({ type: "duplicate-object", id })}
            onDelete={(id) => dispatch({ type: "remove-object", id })}
          />

          <Button
            variant="primary"
            className="hidden w-full lg:flex"
            disabled={!canContinue}
            onClick={() => onContinue(current)}
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
