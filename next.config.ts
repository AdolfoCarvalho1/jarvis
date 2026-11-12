import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.JARVIS_CHECK_DIST_DIR ? { distDir: ".jarvis/check-build" } : {}),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
      ],
    }];
  },
};

export default nextConfig;
