import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.STORYBOOK_NEXT_DIR || ".next",
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["better-sqlite3", "sharp"],
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
