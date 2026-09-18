import type { NextConfig } from "next";

/**
 * The customizer page is served through the Shopify App Proxy: Shopify re-serves
 * our HTML under wearicy.com/apps/icy-customizer, but all _next/static/* URLs
 * in that HTML must point to Vercel's origin, not the storefront.
 *
 * assetPrefix rewrites every _next/static URL at build time so they reference
 * the Vercel deployment.  In development the prefix is empty so local dev still
 * works without a proxy.
 *
 * CORS on /_next/static/ is needed so the browser will accept fonts loaded
 * cross-origin via @font-face inside a CSS file.  Script and stylesheet tags
 * don't require CORS, but @font-face does.
 */
const VERCEL_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://icy-customizer.vercel.app";

const config: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["sharp"],

  assetPrefix: process.env.NODE_ENV === "production" ? VERCEL_URL : "",

  webpack(config) {
    // Konva ships a Node build that requires the native `canvas` package for
    // server-side rendering. The editor is client-only (dynamic, ssr:false),
    // so the dependency is stubbed rather than installed — `canvas` needs
    // native build tooling that serverless builds do not have.
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  },

  async headers() {
    return [
      {
        // Allow cross-origin font loads from the storefront domain.
        source: "/_next/static/:path*",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
      {
        // The admin UI is embedded in the Shopify Admin iframe.
        source: "/admin/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors https://admin.shopify.com https://*.myshopify.com;",
          },
        ],
      },
      {
        // The customizer is served through the Shopify App Proxy.
        source: "/proxy/:path*",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
    ];
  },
};

export default config;
