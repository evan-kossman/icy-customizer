import type { DesignDocument, DesignObject, PrintArea } from "@/lib/design";

/** Product data the editor receives from /api/proxy/config. */
export interface EditorVariant {
  id: string;
  title: string;
  price: string;
  availableForSale: boolean;
  inventoryQuantity: number | null;
  selectedOptions: { name: string; value: string }[];
  image: { url: string } | null;
}

export interface EditorMockup {
  colorName: string;
  colorHex: string | null;
  shopifyVariantId: string | null;
  url: string;
  width: number;
  height: number;
  printArea: { x: number; y: number; width: number; height: number };
}

export interface EditorFont {
  id: string;
  family: string;
  displayName: string;
  source: string;
  url: string | null;
  weights: number[];
  italicSupported: boolean;
}

export interface EditorBootstrap {
  product: {
    id: string;
    title: string;
    handle: string;
    options: { name: string; values: string[] }[];
    variants: EditorVariant[];
  };
  config: {
    id: string;
    productType: string;
    printArea: PrintArea;
    features: { ai: boolean; backgroundRemoval: boolean; text: boolean; stickers: boolean };
    maxUploads: number;
    maxUploadBytes: number;
    stickerCategories: string[];
    aiCredits: number;
  };
  mockups: EditorMockup[];
  fonts: EditorFont[];
  customer: { id: string | null; loggedIn: boolean };
}

/**
 * An asset that exists in the editor. `url` is a displayable image; for an
 * upload that is still processing, `url` may be a local object URL while the
 * server copy uploads in the background.
 */
export interface EditorAsset {
  id: string;
  url: string;
  width: number;
  height: number;
  kind: "upload" | "background_removed" | "ai_generated" | "sticker";
  parentId?: string;
  /** Set while a background-removal or upload request is in flight. */
  pending?: boolean;
  error?: string;
}

export interface EditorState {
  design: DesignDocument;
  assets: Record<string, EditorAsset>;
  selectedId: string | null;
}

export type EditorAction =
  | { type: "add-object"; object: DesignObject }
  | { type: "update-object"; id: string; patch: Partial<DesignObject> }
  | { type: "remove-object"; id: string }
  | { type: "duplicate-object"; id: string }
  | { type: "select"; id: string | null }
  | { type: "reorder"; id: string; direction: "front" | "back" | "forward" | "backward" }
  | { type: "set-color"; color: string; variantId: string | null }
  | { type: "add-asset"; asset: EditorAsset }
  | { type: "update-asset"; id: string; patch: Partial<EditorAsset> }
  | { type: "remove-asset"; id: string }
  | { type: "replace-design"; design: DesignDocument }
  | { type: "center"; id: string; axis: "horizontal" | "vertical" };

export type { DesignDocument, DesignObject, PrintArea };
