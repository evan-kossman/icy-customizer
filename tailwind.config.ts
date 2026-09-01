import type { Config } from "tailwindcss";

// Icy design tokens. Colour values are overridable via CSS variables so the
// storefront's own branding can drive them without a rebuild.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--icy-ink, #111111)",
        accent: "var(--icy-accent, #6C3BFF)",
        "accent-hover": "var(--icy-accent-hover, #5A2FE0)",
        surface: "var(--icy-surface, #FFFFFF)",
        canvas: "var(--icy-canvas, #F4F4F5)",
        line: "var(--icy-line, #E4E4E7)",
        muted: "var(--icy-muted, #71717A)",
      },
      borderRadius: { card: "16px" },
      fontFamily: { sans: ["var(--icy-font)", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
export default config;
