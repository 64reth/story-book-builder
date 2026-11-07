import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
const evidenceFile = ".local/staging-verification.json";
if (!fs.existsSync(evidenceFile))
  throw new Error(
    "Production is gated: verified hosted staging evidence is required first.",
  );
const evidence = JSON.parse(fs.readFileSync(evidenceFile, "utf8"));
const required = [
  "https",
  "ownerAuth",
  "workspace",
  "batchR2",
  "d1Persistence",
  "oauth",
  "dataset",
  "publishingValidation",
  "jobRecovery",
  "resultLinks",
  "noSecretExposure",
  "noUnrelatedChanges",
];
if (
  !evidence.deploymentId ||
  !required.every((key) => evidence.checks?.[key] === true)
)
  throw new Error(
    "Production is gated: a hosted staging prerequisite is incomplete.",
  );
const head = spawnSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).stdout.trim();
if (evidence.commit !== head)
  throw new Error(
    "Production is gated: the tested staging commit differs from HEAD.",
  );
if (!evidence.productionDataReady || !evidence.productionDnsAvailable)
  throw new Error(
    "Production is gated: provision and migrate dedicated production storage and verify the exact DNS name first.",
  );
if (
  spawnSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
  }).stdout.trim()
)
  throw new Error(
    "Production is gated: commit the verified source changes first.",
  );
const database = "d06bc5f4-f30e-4714-9eb9-c01c8fb9b2fd";
const data = JSON.parse(
  fs.readFileSync(".local/production-d1-verification.json", "utf8"),
);
const artwork = JSON.parse(
  fs.readFileSync(".local/production-r2-verification.json", "utf8"),
);
if (
  data.database !== database ||
  artwork.bucket !== "story-book-builder-assets" ||
  artwork.prefix !== "production/" ||
  artwork.objects.length < 44
)
  throw new Error(
    "Production is gated: verified isolated D1/R2 migration evidence is missing.",
  );
const secrets = JSON.parse(
  fs.readFileSync(".local/production-worker-secrets.json", "utf8"),
);
for (const key of [
  "CANVA_CLIENT_ID",
  "CANVA_CLIENT_SECRET",
  "SESSION_SECRET",
  "OWNER_PASSWORD_HASH",
])
  if (secrets[key]?.type !== "secret_text" || !secrets[key].text)
    throw new Error(`Missing production secret: ${key}`);
const secretFile = ".local/production-deploy-secrets.json";
fs.writeFileSync(
  secretFile,
  JSON.stringify(
    Object.fromEntries(
      Object.entries(secrets).map(([key, value]) => [key, value.text]),
    ),
  ),
);
const node = path.resolve("node_modules/node/bin/node.exe");
const run = (args) => {
  const result = spawnSync(node, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run(["node_modules/vite/bin/vite.js", "build", "--mode", "production"]);
const config = JSON.parse(
  fs.readFileSync(
    ".cloudflare/output/v0/workers/default/worker.config.json",
    "utf8",
  ),
);
if (
  config.name !== "story-book-builder" ||
  config.env.DB?.id !== database ||
  config.env.ASSETS?.name !== "story-book-builder-assets" ||
  config.env.STORYBOOK_ARTWORK_PREFIX?.value !== "production/" ||
  !config.domains.includes("storybookbuilder.allencreativetechnologies.uk")
)
  throw new Error(
    "Production resource guard rejected the compiled configuration.",
  );
run([
  "node_modules/cf/bin/cf",
  "deploy",
  "--prebuilt",
  "--mode",
  "production",
  "--secrets-file",
  secretFile,
]);
