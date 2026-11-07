// Provision required secrets atomically on the first Worker deployment.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const node = path.resolve("node_modules/node/bin/node.exe");
const run = (args) => {
  const result = spawnSync(node, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const source = ".local/staging-worker-secrets.json";
if (!fs.existsSync(source))
  throw new Error(
    "Prepare the ignored staging secrets with scripts/cloudflare-data.mjs prepare first.",
  );
const secrets = JSON.parse(fs.readFileSync(source, "utf8"));
for (const key of [
  "CANVA_CLIENT_ID",
  "CANVA_CLIENT_SECRET",
  "SESSION_SECRET",
  "OWNER_PASSWORD_HASH",
])
  if (secrets[key]?.type !== "secret_text" || !secrets[key].text)
    throw new Error(`Missing staging secret: ${key}`);
const secretFile = ".local/staging-deploy-secrets.json";
fs.writeFileSync(
  secretFile,
  JSON.stringify(
    Object.fromEntries(
      Object.entries(secrets).map(([key, value]) => [key, value.text]),
    ),
  ),
);
run(["node_modules/vite/bin/vite.js", "build", "--mode", "staging"]);
const config = JSON.parse(
  fs.readFileSync(
    ".cloudflare/output/v0/workers/default/worker.config.json",
    "utf8",
  ),
);
if (
  config.name !== "story-book-builder-staging" ||
  config.env.ASSETS?.name !== "story-book-builder-assets" ||
  config.env.DB?.id !== "67d9f434-bc57-4df3-9921-c7b0cd49bbd4"
)
  throw new Error(
    "Staging resource guard rejected the compiled configuration.",
  );
run([
  "node_modules/cf/bin/cf",
  "deploy",
  "--prebuilt",
  "--mode",
  "staging",
  "--secrets-file",
  secretFile,
]);
