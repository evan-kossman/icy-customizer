import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Suspense } from "react";
import CustomizerClient from "./CustomizerClient";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * The customizer, served through the Shopify App Proxy so it appears under the
 * storefront domain (wearicy.com/apps/icy-customizer).
 */
export default async function CustomizerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : (value ?? null);
  };

  // Requests arrive already signed by Shopify; the API routes verify that
  // signature. This page only needs the identifiers.
  const proxyBase = env().SHOPIFY_APP_PROXY_PREFIX;

  // Read the logo at server time and embed as a data URL so it loads
  // correctly when the customizer runs under the Shopify proxy domain.
  let logoDataUrl: string | undefined;
  try {
    const logoPath = join(process.cwd(), "public", "icy-logo.avif");
    const logoBuffer = readFileSync(logoPath);
    logoDataUrl = `data:image/avif;base64,${logoBuffer.toString("base64")}`;
  } catch { /* logo not found — header will just be empty */ }

  return (
    <Suspense
      fallback={
        <main className="grid min-h-screen place-items-center text-sm text-muted">
          Loading…
        </main>
      }
    >
      <CustomizerClient
        proxyBase={proxyBase}
        logoDataUrl={logoDataUrl}
        productHandle={one("product")}
        productId={one("productId")}
      />
    </Suspense>
  );
}
