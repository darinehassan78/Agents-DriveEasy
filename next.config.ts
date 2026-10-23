import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Licence uploads (5 MB) and up to 3 damage photos (5 MB each) go through server actions.
  experimental: {
    serverActions: { bodySizeLimit: "16mb" },
    proxyClientMaxBodySize: "16mb",
  },
  partialPrefetching: true,
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
