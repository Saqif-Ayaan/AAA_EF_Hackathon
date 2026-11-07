import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents is off on purpose: the war room is a live dashboard, and
  // classic App Router behaviour avoids "uncached data outside <Suspense>" build errors.

  // Load pdf-parse straight from node_modules instead of bundling it: pdf.js looks for its
  // worker file (pdf.worker.mjs) next to its own code, which doesn't exist inside .next/.
  serverExternalPackages: ["pdf-parse"],

  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
