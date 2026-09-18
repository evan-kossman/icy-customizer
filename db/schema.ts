import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  doublePrecision,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createId } from "@/lib/id";

/**
 * Icy Customizer — relational schema.
 * Large binaries live in object storage; this database holds metadata only.
 */

const id = () => text("id").primaryKey().$defaultFn(createId);
const now = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

// ---------------------------------------------------------------------------
// Shopify app installation
// ---------------------------------------------------------------------------

export const shops = pgTable(
  "shops",
  {
    id: id(),
    domain: text("domain").notNull(), // wearicy.myshopify.com
    accessToken: text("access_token").notNull(), // encrypted at rest
    scopes: text("scopes").notNull(),
    installedAt: now(),
    uninstalledAt: timestamp("uninstalled_at", { withTimezone: true }),
  },
  (t) => ({ domainIdx: uniqueIndex("shops_domain_idx").on(t.domain) })
);

// ---------------------------------------------------------------------------
// Product configuration — admin driven, nothing about products is hardcoded
// ---------------------------------------------------------------------------

export const productConfigs = pgTable(
  "product_configs",
  {
    id: id(),
    shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    shopifyProductId: text("shopify_product_id").notNull(),
    productType: text("product_type").notNull(), // tshirt | hoodie | tote | ...
    enabled: boolean("enabled").default(true).notNull(),

    // Physical print spec. Pixel dimensions derive from inches * dpi.
    printWidthInches: doublePrecision("print_width_inches").notNull(),
    printHeightInches: doublePrecision("print_height_inches").notNull(),
    dpi: integer("dpi").default(300).notNull(),

    // Print-area placement on the mockup as fractions (0..1) — resolution free.
    printAreaX: doublePrecision("print_area_x").default(0.25).notNull(),
    printAreaY: doublePrecision("print_area_y").default(0.22).notNull(),
    printAreaWidth: doublePrecision("print_area_width").default(0.5).notNull(),
    printAreaHeight: doublePrecision("print_area_height").default(0.5).notNull(),

    aiEnabled: boolean("ai_enabled").default(true).notNull(),
    backgroundRemovalEnabled: boolean("background_removal_enabled").default(true).notNull(),
    textEnabled: boolean("text_enabled").default(true).notNull(),
    stickersEnabled: boolean("stickers_enabled").default(true).notNull(),

    maxUploads: integer('max_uploads').default(2).notNull(),
    maxUploadBytes: integer("max_upload_bytes").default(10485760).notNull(),

    stickerCategories: text("sticker_categories").array().default([]).notNull(),
    fontIds: text("font_ids").array().default([]).notNull(),

    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    productIdx: uniqueIndex("product_configs_shop_product_idx").on(t.shopId, t.shopifyProductId),
    enabledIdx: index("product_configs_enabled_idx").on(t.shopId, t.enabled),
  })
);

/** One mockup image per colour, optionally pinned to a specific variant. */
export const mockups = pgTable(
  "mockups",
  {
    id: id(),
    productConfigId: text("product_config_id")
      .notNull()
      .references(() => productConfigs.id, { onDelete: "cascade" }),
    colorName: text("color_name").notNull(), // matches the Shopify option value
    colorHex: text("color_hex"),
    shopifyVariantId: text("shopify_variant_id"),

    assetKey: text("asset_key").notNull(),
    thumbKey: text("thumb_key"),
    width: integer("width").notNull(),
    height: integer("height").notNull(),

    // Optional per-mockup print-area override.
    printAreaX: doublePrecision("print_area_x"),
    printAreaY: doublePrecision("print_area_y"),
    printAreaWidth: doublePrecision("print_area_width"),
    printAreaHeight: doublePrecision("print_area_height"),

    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: now(),
  },
  (t) => ({
    colorIdx: uniqueIndex("mockups_config_color_idx").on(t.productConfigId, t.colorName),
  })
);

// ---------------------------------------------------------------------------
// Artwork library
// ---------------------------------------------------------------------------

export const stickers = pgTable(
  "stickers",
  {
    id: id(),
    shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category").notNull(),
    tags: text("tags").array().default([]).notNull(),
    assetKey: text("asset_key").notNull(),
    thumbKey: text("thumb_key").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: now(),
  },
  (t) => ({ catIdx: index("stickers_shop_cat_idx").on(t.shopId, t.category, t.enabled) })
);

export const fonts = pgTable(
  "fonts",
  {
    id: id(),
    shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    family: text("family").notNull(),
    displayName: text("display_name").notNull(),
    source: text("source").default("google").notNull(), // google | custom
    fileKey: text("file_key"),
    weights: integer("weights").array().default([400, 700]).notNull(),
    italicSupported: boolean("italic_supported").default(true).notNull(),
    licenseNotes: text("license_notes"),
    enabled: boolean("enabled").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
  },
  (t) => ({ familyIdx: uniqueIndex("fonts_shop_family_idx").on(t.shopId, t.family) })
);

// ---------------------------------------------------------------------------
// Design sessions — transient, not a permanent customer design library
// ---------------------------------------------------------------------------

export const designStatus = pgEnum("design_status", [
  "draft",
  "confirmed",
  "rendering",
  "ready",
  "in_cart",
  "ordered",
  "expired",
  "failed",
]);

export const designSessions = pgTable(
  "design_sessions",
  {
    id: id(),
    publicId: text("public_id").notNull(), // ICY-XXXXXXXX
    shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    productConfigId: text("product_config_id").notNull().references(() => productConfigs.id),

    shopifyProductId: text("shopify_product_id").notNull(),
    shopifyVariantId: text("shopify_variant_id"),
    selectedColor: text("selected_color"),

    // Anonymous browser identity, upgraded to the customer id once known.
    clientToken: text("client_token").notNull(),
    shopifyCustomerId: text("shopify_customer_id"),

    designJson: jsonb("design_json").notNull().default({}),
    designHash: text("design_hash"),

    previewKey: text("preview_key"),
    productionFileKey: text("production_file_key"),
    productionWidth: integer("production_width"),
    productionHeight: integer("production_height"),

    rightsConfirmed: boolean("rights_confirmed").default(false).notNull(),
    rightsConfirmedAt: timestamp("rights_confirmed_at", { withTimezone: true }),
    overflowAcknowledged: boolean("overflow_acknowledged").default(false).notNull(),
    overflowAcknowledgedAt: timestamp("overflow_acknowledged_at", { withTimezone: true }),

    status: designStatus("status").default("draft").notNull(),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    publicIdx: uniqueIndex("design_sessions_public_id_idx").on(t.publicId),
    statusIdx: index("design_sessions_status_idx").on(t.shopId, t.status),
    expiryIdx: index("design_sessions_expiry_idx").on(t.expiresAt),
    customerIdx: index("design_sessions_customer_idx").on(t.shopifyCustomerId),
  })
);

export const assetKind = pgEnum("asset_kind", [
  "upload",
  "background_removed",
  "ai_generated",
  "sticker",
  "preview",
  "production",
]);

export const designAssets = pgTable(
  "design_assets",
  {
    id: id(),
    sessionId: text("session_id")
      .notNull()
      .references(() => designSessions.id, { onDelete: "cascade" }),
    kind: assetKind("kind").notNull(),
    storageKey: text("storage_key").notNull(),
    thumbKey: text("thumb_key"),
    mimeType: text("mime_type").notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    // Links a processed asset to the original, so background removal can be
    // toggled off without a re-upload.
    parentAssetId: text("parent_asset_id"),
    createdAt: now(),
  },
  (t) => ({ sessionIdx: index("design_assets_session_idx").on(t.sessionId, t.kind) })
);

// ---------------------------------------------------------------------------
// Orders and production
// ---------------------------------------------------------------------------

export const productionStatus = pgEnum("production_status", [
  "pending",
  "ready",
  "in_production",
  "complete",
]);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    shopifyOrderId: text("shopify_order_id").notNull(),
    orderNumber: text("order_number").notNull(),
    customerEmail: text("customer_email"),
    createdAt: now(),
  },
  (t) => ({ orderIdx: uniqueIndex("orders_shop_order_idx").on(t.shopId, t.shopifyOrderId) })
);

export const orderLineItems = pgTable(
  "order_line_items",
  {
    id: id(),
    orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    shopifyLineItemId: text("shopify_line_item_id").notNull(),
    shopifyVariantId: text("shopify_variant_id").notNull(),
    variantTitle: text("variant_title").notNull(),
    quantity: integer("quantity").notNull(),

    sessionId: text("session_id").references(() => designSessions.id),
    designPublicId: text("design_public_id"),

    productionStatus: productionStatus("production_status").default("pending").notNull(),
    productionNotes: text("production_notes"),
  },
  (t) => ({
    lineIdx: uniqueIndex("order_line_items_line_idx").on(t.orderId, t.shopifyLineItemId),
    designIdx: index("order_line_items_design_idx").on(t.designPublicId),
  })
);

// ---------------------------------------------------------------------------
// AI credits — authoritative server-side ledger
// ---------------------------------------------------------------------------

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    shopifyCustomerId: text("shopify_customer_id").notNull(),
    sessionId: text("session_id"),
    prompt: text("prompt").notNull(),
    // Client-supplied key; prevents double-charging on retry or double click.
    idempotencyKey: text("idempotency_key").notNull(),
    succeeded: boolean("succeeded").default(false).notNull(),
    assetId: text("asset_id"),
    createdAt: now(),
  },
  (t) => ({
    idemIdx: uniqueIndex("ai_usage_idem_idx").on(t.shopId, t.idempotencyKey),
    customerIdx: index("ai_usage_customer_idx").on(t.shopId, t.shopifyCustomerId),
  })
);

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: id(),
    shopDomain: text("shop_domain").notNull(),
    name: text("name").notNull(),
    sessionId: text("session_id"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: now(),
  },
  (t) => ({ nameIdx: index("analytics_name_idx").on(t.shopDomain, t.name, t.createdAt) })
);
