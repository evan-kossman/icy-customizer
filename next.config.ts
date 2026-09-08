import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["sharp"],
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
