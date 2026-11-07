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
if (
  !process.env.STORYBOOK_PRODUCTION_DB_ID ||
  !evidence.productionDataReady ||
  !evidence.productionDnsAvailable
)
  throw new Error(
    "Production is gated: provision and migrate dedicated production storage and verify the exact DNS name first.",
  );
const result = spawnSync(
  path.resolve("node_modules/node/bin/node.exe"),
  [
    "node_modules/@vinext/cloudflare/dist/cli.js",
    "deploy",
    "--env",
    "production",
  ],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
