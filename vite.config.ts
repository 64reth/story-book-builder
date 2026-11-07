import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "node:path";

export default defineConfig({
  build: { rolldownOptions: { external: ["cloudflare:workers"] } },
  resolve: {
    alias: {
      "@/lib/platform": path.resolve("src/lib/platform-worker.ts"),
      "@/lib/image-codec": path.resolve("src/lib/image-codec-worker.ts"),
    },
  },
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
