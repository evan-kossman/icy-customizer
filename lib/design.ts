import { createHash } from "node:crypto";

/**
 * The design coordinate system.
 *
 * All object geometry is expressed in PRINT PIXELS — the physical pixel grid
 * derived from the product's configured inches x DPI (e.g. 12in x 16in @ 300dpi
 * = 3600 x 4800). Screen size, device pixel ratio and browser zoom never enter
 * the stored design. The editor renders a scaled view of this grid; the
 * production renderer reproduces it 1:1.
 */

export interface PrintArea {
  /** Physical print size. */
  widthInches: number;
  heightInches: number;
  dpi: number;
  /** Derived pixel dimensions of the printable canvas. */
  widthPx: number;
  heightPx: number;
  /** Placement on the mockup image, as fractions of the mockup (0..1). */
  mockupX: number;
  mockupY: number;
  mockupWidth: number;
  mockupHeight: number;
}

export function buildPrintArea(cfg: {
  printWidthInches: number;
  printHeightInches: number;
  dpi: number;
  printAreaX: number;
  printAreaY: number;
  printAreaWidth: number;
  printAreaHeight: number;
}): PrintArea {
  return {
    widthInches: cfg.printWidthInches,
    heightInches: cfg.printHeightInches,
    dpi: cfg.dpi,
    widthPx: Math.round(cfg.printWidthInches * cfg.dpi),
    heightPx: Math.round(cfg.printHeightInches * cfg.dpi),
    mockupX: cfg.printAreaX,
    mockupY: cfg.printAreaY,
    mockupWidth: cfg.printAreaWidth,
    mockupHeight: cfg.printAreaHeight,
  };
}

export type DesignObjectType = "image" | "ai-image" | "sticker" | "text";

export interface BaseObject {
  id: string;
  type: DesignObjectType;
  /** Centre-anchored position in print pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // degrees
  scaleX: number;
  scaleY: number;
  opacity: number;
  zIndex: number;
  visible: boolean;
  locked: boolean;
}

export interface ImageObject extends BaseObject {
  type: "image" | "ai-image" | "sticker";
  assetId: string;
  /** Original upload, kept so background removal can be toggled off. */
  originalAssetId?: string;
  backgroundRemoved: boolean;
  /** Intrinsic pixels of the source image — used for the DPI warning. */
  sourceWidth: number;
  sourceHeight: number;
}

export interface TextObject extends BaseObject {
  type: "text";
  text: string;
  fontFamily: string;
  fontSize: number; // print pixels
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  uppercase: boolean;
  fill: string;
  align: "left" | "center" | "right";
  letterSpacing: number;
  lineHeight: number;
  strokeColor?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  backgroundColor?: string;
}

export type DesignObject = ImageObject | TextObject;

export interface DesignDocument {
  version: 1;
  productId: string;
  productConfigId: string;
  baseVariantId: string | null;
  color: string | null;
  printArea: PrintArea;
  objects: DesignObject[];
}

export function emptyDesign(
  productId: string,
  productConfigId: string,
  printArea: PrintArea
): DesignDocument {
  return {
    version: 1,
    productId,
    productConfigId,
    baseVariantId: null,
    color: null,
    printArea,
    objects: [],
  };
}

/** Axis-aligned bounding box of an object after scale and rotation. */
export function objectBounds(o: DesignObject) {
  const w = o.width * o.scaleX;
  const h = o.height * o.scaleY;
  const rad = (o.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const bw = w * cos + h * sin;
  const bh = w * sin + h * cos;
  return {
    left: o.x - bw / 2,
    top: o.y - bh / 2,
    right: o.x + bw / 2,
    bottom: o.y + bh / 2,
    width: bw,
    height: bh,
  };
}

/** True when any visible object extends past the printable canvas. */
export function hasOverflow(design: DesignDocument): boolean {
  const { widthPx, heightPx } = design.printArea;
  return design.objects.some((o) => {
    if (!o.visible) return false;
    const b = objectBounds(o);
    return b.left < 0 || b.top < 0 || b.right > widthPx || b.bottom > heightPx;
  });
}

/**
 * Effective DPI of an image object at its rendered print size. Compared against
 * the product DPI to decide whether to warn the customer.
 */
export function effectiveDpi(o: ImageObject, printArea: PrintArea): number {
  const renderedWidthInches = (o.width * o.scaleX) / printArea.dpi;
  if (renderedWidthInches <= 0) return 0;
  return o.sourceWidth / renderedWidthInches;
}

export type QualityLevel = "good" | "low" | "invalid";

export function imageQuality(
  o: ImageObject,
  printArea: PrintArea
): { level: QualityLevel; dpi: number } {
  const dpi = effectiveDpi(o, printArea);
  if (dpi < 72) return { level: "invalid", dpi };
  if (dpi < 150) return { level: "low", dpi };
  return { level: "good", dpi };
}

const FINITE = (n: unknown) => typeof n === "number" && Number.isFinite(n);

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  overflow: boolean;
}

/** Server-side validation run before any production render or cart insertion. */
export function validateDesign(design: DesignDocument): ValidationResult {
  const errors: string[] = [];

  if (design.version !== 1) errors.push("Unsupported design version.");
  if (!design.printArea || !FINITE(design.printArea.widthPx) || design.printArea.widthPx <= 0)
    errors.push("Print area is missing or invalid.");
  const visible = design.objects.filter((o) => o.visible);
  if (visible.length === 0) errors.push("The design has no visible elements.");

  for (const o of design.objects) {
    for (const key of ["x", "y", "width", "height", "rotation", "scaleX", "scaleY", "opacity"] as const) {
      if (!FINITE(o[key])) errors.push(`Object ${o.id}: ${key} is not a finite number.`);
    }
    if (o.width <= 0 || o.height <= 0) errors.push(`Object ${o.id} has zero size.`);
    if (o.type === "text") {
      if (!o.text.trim()) errors.push(`Text object ${o.id} is empty.`);
      if (!FINITE(o.fontSize) || o.fontSize <= 0)
        errors.push(`Text object ${o.id} has an invalid font size.`);
    } else if (!o.assetId) {
      errors.push(`Image object ${o.id} has no asset reference.`);
    }
  }

  return { ok: errors.length === 0, errors, overflow: hasOverflow(design) };
}

/**
 * Deterministic hash of the meaningful design state. Used to detect duplicate
 * renders and to tie cart lines to a design — never as an authorisation token.
 */
export function designHash(design: DesignDocument): string {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const normalised = {
    p: design.productId,
    c: design.color,
    a: [design.printArea.widthPx, design.printArea.heightPx],
    o: [...design.objects]
      .filter((o) => o.visible)
      .sort((a, b) => a.zIndex - b.zIndex)
      .map((o) => {
        const base = [
          o.type,
          round(o.x),
          round(o.y),
          round(o.width),
          round(o.height),
          round(o.rotation),
          round(o.scaleX),
          round(o.scaleY),
          round(o.opacity),
        ];
        return o.type === "text"
          ? [...base, o.text, o.fontFamily, round(o.fontSize), o.fontWeight, o.fill]
          : [...base, o.assetId, o.backgroundRemoved];
      }),
  };
  return createHash("sha256")
    .update(JSON.stringify(normalised))
    .digest("hex")
    .slice(0, 32);
}

/** Customer-facing design id, e.g. ICY-7F3A9C2D. */
export function newPublicId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `ICY-${out}`;
}
