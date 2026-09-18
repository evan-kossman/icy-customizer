import { proxyFetch } from "@/lib/client-token";
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { editorReducer } from "./reducer";
import type { EditorAction, EditorState } from "./types";
import type { DesignDocument } from "@/lib/design";

const HISTORY_LIMIT = 50;

/**
 * Editor state with undo/redo.
 *
 * Actions that fire continuously during a drag would otherwise flood the
 * history stack, so callers pass `transient: true` while a gesture is in
 * progress and commit once on release.
 */
export function useEditorState(initial: EditorState) {
  const [state, setState] = useState<EditorState>(initial);
  const past = useRef<EditorState[]>([]);
  const future = useRef<EditorState[]>([]);
  const [version, setVersion] = useState(0);

  const dispatch = useCallback(
    (action: EditorAction, options?: { transient?: boolean }) => {
      setState((current) => {
        const next = editorReducer(current, action);
        if (next === current) return current;

        if (!options?.transient) {
          past.current = [...past.current, current].slice(-HISTORY_LIMIT);
          future.current = [];
        }
        return next;
      });
      setVersion((v) => v + 1);
    },
    []
  );

  /** Commits the pre-gesture state so one drag equals one undo step. */
  const beginGesture = useCallback(() => {
    setState((current) => {
      past.current = [...past.current, current].slice(-HISTORY_LIMIT);
      future.current = [];
      return current;
    });
  }, []);

  const undo = useCallback(() => {
    setState((current) => {
      const previous = past.current[past.current.length - 1];
      if (!previous) return current;
      past.current = past.current.slice(0, -1);
      future.current = [current, ...future.current].slice(0, HISTORY_LIMIT);
      return previous;
    });
    setVersion((v) => v + 1);
  }, []);

  const redo = useCallback(() => {
    setState((current) => {
      const next = future.current[0];
      if (!next) return current;
      future.current = future.current.slice(1);
      past.current = [...past.current, current].slice(-HISTORY_LIMIT);
      return next;
    });
    setVersion((v) => v + 1);
  }, []);

  const canUndo = past.current.length > 0;
  const canRedo = future.current.length > 0;

  return { state, setState, dispatch, beginGesture, undo, redo, canUndo, canRedo, version };
}

/**
 * Maps between print-pixel coordinates (the authoritative design space) and
 * on-screen pixels.
 *
 * The mockup image is laid out at `displayWidth`; the print area occupies a
 * fractional rectangle within it. Everything the customer sees is derived from
 * this scale, and nothing is ever stored in screen units.
 */
export interface CanvasGeometry {
  scale: number;
  displayWidth: number;
  displayHeight: number;
  printLeft: number;
  printTop: number;
  printWidth: number;
  printHeight: number;
  toScreen: (printPx: number) => number;
  toPrint: (screenPx: number) => number;
}

export function useCanvasGeometry(opts: {
  displayWidth: number;
  mockupAspect: number;
  printAreaFraction: { x: number; y: number; width: number; height: number };
  printWidthPx: number;
}): CanvasGeometry {
  return useMemo(() => {
    const displayHeight = opts.displayWidth * opts.mockupAspect;
    const printWidth = opts.displayWidth * opts.printAreaFraction.width;
    const printHeight = displayHeight * opts.printAreaFraction.height;
    const scale = opts.printWidthPx > 0 ? printWidth / opts.printWidthPx : 1;

    return {
      scale,
      displayWidth: opts.displayWidth,
      displayHeight,
      printLeft: opts.displayWidth * opts.printAreaFraction.x,
      printTop: displayHeight * opts.printAreaFraction.y,
      printWidth,
      printHeight,
      toScreen: (printPx: number) => printPx * scale,
      toPrint: (screenPx: number) => (scale > 0 ? screenPx / scale : screenPx),
    };
  }, [
    opts.displayWidth,
    opts.mockupAspect,
    opts.printAreaFraction.x,
    opts.printAreaFraction.y,
    opts.printAreaFraction.width,
    opts.printAreaFraction.height,
    opts.printWidthPx,
  ]);
}

/**
 * Measures a container element, so the canvas is sized from real layout rather
 * than window width. Handles orientation changes and panel resizes.
 */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => setWidth(element.clientWidth);
    update();

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

// ---------------------------------------------------------------------------
// Autosave
// ---------------------------------------------------------------------------

const LOCAL_KEY = "icy:design:";

export type SaveStatus = "idle" | "saving" | "saved" | "local-only" | "error";

/**
 * Two-tier autosave.
 *
 * Local (IndexedDB-backed localStorage here) is written on every change so a
 * refresh or crash never loses work. Server persistence is debounced and only
 * carries the structured design JSON — never rendered images.
 */
export function useAutosave(opts: {
  sessionId: string | null;
  design: DesignDocument;
  version: number;
  enabled: boolean;
  proxyBase: string;
}) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSent = useRef<string>("");

  // Immediate local save — cheap, synchronous, never lost.
  useEffect(() => {
    if (!opts.sessionId) return;
    try {
      window.localStorage.setItem(
        LOCAL_KEY + opts.sessionId,
        JSON.stringify({ design: opts.design, savedAt: Date.now() })
      );
    } catch {
      // Quota or private browsing: server save still applies.
    }
  }, [opts.design, opts.sessionId, opts.version]);

  // Debounced server save.
  useEffect(() => {
    if (!opts.enabled || !opts.sessionId) return;

    const payload = JSON.stringify(opts.design);
    if (payload === lastSent.current) return;

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setStatus("saving");
      try {
        const res = await proxyFetch(`${opts.proxyBase}/api/session/${opts.sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ design: opts.design }),
        });
        if (!res.ok) throw new Error(String(res.status));
        lastSent.current = payload;
        setStatus("saved");
      } catch {
        // Local copy still holds the work; surface that rather than alarming.
        setStatus("local-only");
      }
    }, 1500);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [opts.design, opts.enabled, opts.proxyBase, opts.sessionId, opts.version]);

  return status;
}

export function loadLocalDesign(sessionId: string): DesignDocument | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY + sessionId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { design: DesignDocument };
    return parsed.design ?? null;
  } catch {
    return null;
  }
}

export function clearLocalDesign(sessionId: string) {
  try {
    window.localStorage.removeItem(LOCAL_KEY + sessionId);
  } catch {
    /* ignore */
  }
}

/** Warns before navigation while unsaved local work exists. */
export function useUnloadGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active]);
}
