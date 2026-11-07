import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig(({ mode }) => {
  const production = mode === "production";
  const origin = production
    ? "https://storybookbuilder.allencreativetechnologies.uk"
    : "https://story-book-builder-staging.garetha81.workers.dev";
  return {
    accountId: "203bf3287fc4eb1260ec344a3e0f5071",
    worker: defineWorker({
      name: production ? "story-book-builder" : "story-book-builder-staging",
      domains: production
        ? ["storybookbuilder.allencreativetechnologies.uk"]
        : [],
      entrypoint: "vinext/server/fetch-handler",
      compatibilityDate: "2026-11-06",
      compatibilityFlags: [
        "nodejs_compat",
        "nodejs_compat_populate_process_env",
      ],
      assets: {
        htmlHandling: "none",
        notFoundHandling: "none",
        runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
      },
      env: {
        ASSETS: bindings.assets(),
        DB: bindings.d1(
          production
            ? {
                name: "story-book-builder-production",
                id: process.env.STORYBOOK_PRODUCTION_DB_ID,
              }
            : {
                id: "67d9f434-bc57-4df3-9921-c7b0cd49bbd4",
                name: "story-book-builder-staging",
              },
        ),
        ARTWORK: bindings.r2({
          name: production
            ? "story-book-builder-production-artwork"
            : "story-book-builder-staging-artwork",
        }),
        APP_URL: bindings.text(origin),
        STORYBOOK_DEPLOYED: bindings.text("1"),
        CANVA_REDIRECT_URI: bindings.text(`${origin}/auth/canva/callback`),
        CANVA_TEMPLATE_DESIGN_ID: bindings.text("DAHaJgBbCJ4"),
        CANVA_CLIENT_ID: bindings.secret(),
        CANVA_CLIENT_SECRET: bindings.secret(),
        SESSION_SECRET: bindings.secret(),
        OWNER_PASSWORD_HASH: bindings.secret(),
      },
    }),
  };
});
