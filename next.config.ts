import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["sharp"],
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
