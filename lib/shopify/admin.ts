import { env } from "../env";
import { decrypt } from "../crypto";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

/**
 * Shopify Admin API client. Server-side only — the access token never leaves
 * this module, and no route ever returns it.
 */

export class ShopifyApiError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
    this.name = "ShopifyApiError";
  }
}

export interface ShopContext {
  id: string;
  domain: string;
  accessToken: string;
}

/** Loads an installed shop and decrypts its token. */
export async function getShop(domain: string): Promise<ShopContext | null> {
  const rows = await db
    .select()
    .from(schema.shops)
    .where(eq(schema.shops.domain, domain))
    .limit(1);

  const shop = rows[0];
  if (!shop || shop.uninstalledAt) return null;
  return { id: shop.id, domain: shop.domain, accessToken: decrypt(shop.accessToken) };
}

export async function adminGraphQL<T>(
  shop: ShopContext,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(
    `https://${shop.domain}/admin/api/${env().SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": shop.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  if (!res.ok) {
    throw new ShopifyApiError(
      `Shopify Admin API returned ${res.status}`,
      res.status,
      await res.text().catch(() => undefined)
    );
  }

  const body = (await res.json()) as { data?: T; errors?: unknown[] };
  if (body.errors?.length) {
    throw new ShopifyApiError("Shopify GraphQL error", 200, body.errors);
  }
  if (!body.data) throw new ShopifyApiError("Shopify returned no data", 200);
  return body.data;
}

// ---------------------------------------------------------------------------
// Product queries
// ---------------------------------------------------------------------------

export interface ShopifyVariant {
  id: string;
  title: string;
  price: string;
  availableForSale: boolean;
  inventoryQuantity: number | null;
  selectedOptions: { name: string; value: string }[];
  image: { url: string } | null;
}

export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  status: string;
  options: { name: string; values: string[] }[];
  variants: ShopifyVariant[];
  customizable: boolean;
  featuredImage: string | null;
}

const PRODUCT_FIELDS = `
  id
  title
  handle
  status
  featuredImage { url }
  options { name values }
  customizable: metafield(namespace: "icy", key: "customizable") { value }
  variants(first: 100) {
    nodes {
      id
      title
      price
      availableForSale
      inventoryQuantity
      selectedOptions { name value }
      image { url }
    }
  }
`;

type RawProduct = {
  id: string;
  title: string;
  handle: string;
  status: string;
  featuredImage: { url: string } | null;
  options: { name: string; values: string[] }[];
  customizable: { value: string } | null;
  variants: { nodes: ShopifyVariant[] };
};

function mapProduct(p: RawProduct): ShopifyProduct {
  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    status: p.status,
    options: p.options,
    variants: p.variants.nodes,
    customizable: p.customizable?.value === "true",
    featuredImage: p.featuredImage?.url ?? null,
  };
}

/**
 * Fetches a product with its variants. This is the authoritative source for
 * pricing, availability and variant ids — the customizer never computes them.
 */
export async function fetchProduct(
  shop: ShopContext,
  productId: string
): Promise<ShopifyProduct | null> {
  const data = await adminGraphQL<{ product: RawProduct | null }>(
    shop,
    `query Product($id: ID!) { product(id: $id) { ${PRODUCT_FIELDS} } }`,
    { id: productId }
  );
  return data.product ? mapProduct(data.product) : null;
}

export async function fetchProductByHandle(
  shop: ShopContext,
  handle: string
): Promise<ShopifyProduct | null> {
  const data = await adminGraphQL<{ productByIdentifier: RawProduct | null }>(
    shop,
    `query ProductByHandle($handle: String!) {
       productByIdentifier(identifier: { handle: $handle }) { ${PRODUCT_FIELDS} }
     }`,
    { handle }
  );
  return data.productByIdentifier ? mapProduct(data.productByIdentifier) : null;
}

/** Lists products for the admin product-configuration screen. */
export async function listProducts(
  shop: ShopContext,
  opts: { query?: string; first?: number; after?: string } = {}
) {
  const data = await adminGraphQL<{
    products: {
      nodes: RawProduct[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  }>(
    shop,
    `query Products($first: Int!, $after: String, $query: String) {
       products(first: $first, after: $after, query: $query, sortKey: TITLE) {
         nodes { ${PRODUCT_FIELDS} }
         pageInfo { hasNextPage endCursor }
       }
     }`,
    { first: opts.first ?? 25, after: opts.after ?? null, query: opts.query ?? null }
  );

  return {
    products: data.products.nodes.map(mapProduct),
    pageInfo: data.products.pageInfo,
  };
}

/** Writes the icy.customizable boolean metafield when a product is configured. */
export async function setCustomizableMetafield(
  shop: ShopContext,
  productId: string,
  value: boolean
) {
  const data = await adminGraphQL<{
    metafieldsSet: { userErrors: { field: string[]; message: string }[] };
  }>(
    shop,
    `mutation SetCustomizable($metafields: [MetafieldsSetInput!]!) {
       metafieldsSet(metafields: $metafields) {
         userErrors { field message }
       }
     }`,
    {
      metafields: [
        {
          ownerId: productId,
          namespace: "icy",
          key: "customizable",
          type: "boolean",
          value: String(value),
        },
      ],
    }
  );

  const errors = data.metafieldsSet.userErrors;
  if (errors.length) {
    throw new ShopifyApiError(
      `Could not update the customizable metafield: ${errors
        .map((e) => e.message)
        .join("; ")}`,
      400,
      errors
    );
  }
}
