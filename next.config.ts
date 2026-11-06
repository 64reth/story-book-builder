import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The OAuth callback uses 127.0.0.1, including when Next was started on localhost.
  allowedDevOrigins: ["127.0.0.1"],
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
