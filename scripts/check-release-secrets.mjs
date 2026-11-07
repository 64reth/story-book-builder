// Check actual local secret values without echoing them or reading private data
// into generated source. Ignored migration files are deliberately not scanned.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
process.loadEnvFile(".env.local");
const values = [process.env.SESSION_SECRET, process.env.CANVA_CLIENT_SECRET];
for (const environment of ["staging", "production"]) {
  const secrets = `.local/${environment}-worker-secrets.json`;
  if (fs.existsSync(secrets))
    values.push(
      ...Object.values(JSON.parse(fs.readFileSync(secrets, "utf8"))).map(
        (value) => value.text,
      ),
    );
  const access = `.local/${environment}-owner-access.json`;
  if (fs.existsSync(access))
    values.push(JSON.parse(fs.readFileSync(access, "utf8")).password);
}
const needles = [
  ...new Set(
    values.filter((value) => typeof value === "string" && value.length >= 12),
  ),
].map((value) => Buffer.from(value));
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const root = ".cloudflare/output/v0";
if (fs.existsSync(root))
  files.push(
    ...fs
      .readdirSync(root, { recursive: true })
      .filter((file) => /\.(js|css|map|json)$/.test(file))
      .map((file) => path.join(root, file)),
  );
const matches = files.filter(
  (file) =>
    fs.existsSync(file) &&
    needles.some((needle) => fs.readFileSync(file).includes(needle)),
);
const forbidden = execFileSync(
  "git",
  [
    "log",
    "--all",
    "--format=",
    "--name-only",
    "--",
    ".env.local",
    ".dev.vars",
    ".local",
    "data",
  ],
  { encoding: "utf8" },
).trim();
console.log(
  JSON.stringify({
    secretValueMatches: matches,
    forbiddenPrivatePathsInHistory: Boolean(forbidden),
  }),
);
if (matches.length || forbidden) process.exitCode = 1;
