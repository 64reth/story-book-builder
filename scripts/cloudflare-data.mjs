// Explicitly scoped migration/deployment helper. No credentials are printed.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes, pbkdf2Sync, createHash } from "node:crypto";
import Database from "better-sqlite3";
const environment = process.argv.includes("--production")
  ? "production"
  : "staging";
const production = environment === "production";
const account = "203bf3287fc4eb1260ec344a3e0f5071",
  database = production
    ? "d06bc5f4-f30e-4714-9eb9-c01c8fb9b2fd"
    : "67d9f434-bc57-4df3-9921-c7b0cd49bbd4";
const worker = production ? "story-book-builder" : "story-book-builder-staging",
  bucket = "story-book-builder-assets";
const prefix = production ? "production/" : "";
const origin = production
  ? "https://storybookbuilder.allencreativetechnologies.uk"
  : `https://${worker}.garetha81.workers.dev`;
const local = path.resolve(".local");
fs.mkdirSync(local, { recursive: true });
function cf(args, retry = true) {
  const result = spawnSync(
    path.resolve("node_modules/node/bin/node.exe"),
    ["node_modules/cf/bin/cf", ...args, "--mode", environment],
    {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: account },
    },
  );
  if (result.status !== 0) {
    if (retry && /\[7403\]/.test(result.stderr ?? "")) {
      console.log(
        "Cloudflare rejected authentication before executing the operation; retrying once.",
      );
      return cf(args, false);
    }
    const codes = [
      ...(result.stderr ?? "").matchAll(/\[(\d+)\]\s*([^\r\n]+)/g),
    ].map((m) => m[0]);
    throw new Error(
      `Cloudflare ${args.slice(0, 3).join(" ")} failed (exit ${result.status}). ${codes.join(" ")}`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { completed: true };
  }
}
const action = process.argv[2];
if (action === "prepare") {
  process.loadEnvFile(".env.local");
  const accessFile = path.join(local, `${environment}-owner-access.json`);
  if (!fs.existsSync(accessFile)) {
    const password = randomBytes(24).toString("base64url"),
      salt = randomBytes(16).toString("hex");
    const values = {
      SESSION_SECRET: randomBytes(32).toString("hex"),
      OWNER_PASSWORD_HASH: `${salt}:${pbkdf2Sync(password, Buffer.from(salt, "hex"), 100000, 32, "sha256").toString("hex")}`,
      CANVA_CLIENT_ID: process.env.CANVA_CLIENT_ID,
      CANVA_CLIENT_SECRET: process.env.CANVA_CLIENT_SECRET,
    };
    if (!values.CANVA_CLIENT_ID || !values.CANVA_CLIENT_SECRET)
      throw new Error("Local Canva configuration is incomplete.");
    fs.writeFileSync(
      accessFile,
      JSON.stringify({ url: origin, password }, null, 2),
      { flag: "wx" },
    );
    fs.writeFileSync(
      path.join(local, `${environment}-worker-secrets.json`),
      JSON.stringify(
        Object.fromEntries(
          Object.entries(values).map(([key, text]) => [
            key,
            { type: "secret_text", text },
          ]),
        ),
      ),
      { flag: "wx" },
    );
  }
  console.log(
    `Prepared ignored ${environment} owner-access and secret files. Existing local environment was not changed.`,
  );
} else if (action === "schema") {
  const batch = [
    {
      sql: "CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
    },
  ];
  for (const file of [
    "001-foundation.sql",
    "002-atomic-storage.sql",
    "003-canva-refresh.sql",
  ]) {
    const sql = fs
      .readFileSync(`migrations/${file}`, "utf8")
      .replace(/^--.*$/gm, "");
    const trigger = sql.match(/CREATE TRIGGER[\s\S]*?END;/)?.[0];
    for (const statement of (trigger ? sql.replace(trigger, "") : sql)
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      batch.push({ sql: statement });
    if (trigger) batch.push({ sql: trigger });
    batch.push({
      sql: "INSERT OR IGNORE INTO migrations VALUES (?,?)",
      params: [file.slice(0, 3), new Date().toISOString()],
    });
  }
  const file = path.join(local, `${environment}-schema-batch.json`);
  fs.writeFileSync(file, JSON.stringify(batch));
  cf(["d1", "query", database, "--batch", `@${file}`]);
  console.log(`${environment} D1 schema applied; no existing rows reset.`);
} else if (action === "metadata") {
  const db = new Database("data/storybook.sqlite", { readonly: true });
  const batch = [],
    counts = {};
  // Session-bound OAuth states and rotating tokens stay local. Hosted OAuth is
  // authorised independently, avoiding shared refresh-token rotation races.
  for (const table of [
    "books",
    "pages",
    "assets",
    "templates",
    "publishing_jobs",
    "generated_designs",
    "versions",
    "settings",
  ]) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all();
    counts[table] = rows.length;
    for (const row of rows) {
      const keys = Object.keys(row);
      batch.push({
        sql: `INSERT OR IGNORE INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
        params: keys.map((k) => row[k]),
      });
    }
  }
  db.close();
  const file = path.join(local, `${environment}-metadata-batch.json`);
  fs.writeFileSync(file, JSON.stringify(batch));
  cf(["d1", "query", database, "--batch", `@${file}`]);
  console.log(
    JSON.stringify({
      imported: counts,
      credentials: "preserved locally; reconnect hosted Canva independently",
    }),
  );
} else if (action === "verify") {
  const db = new Database("data/storybook.sqlite", { readonly: true }),
    report = [];
  for (const table of [
    "books",
    "pages",
    "assets",
    "templates",
    "publishing_jobs",
    "generated_designs",
    "versions",
    "settings",
  ]) {
    const localRows = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
    const remote = cf([
      "d1",
      "query",
      database,
      "--sql",
      `SELECT * FROM ${table} ORDER BY id`,
    ]);
    const rows = Array.isArray(remote)
      ? remote[0]?.results
      : remote.result?.[0]?.results;
    if (!Array.isArray(rows))
      throw new Error(
        `Could not parse D1 verification results for ${table}; verification not claimed.`,
      );
    const canonical = (values) =>
      JSON.stringify(
        values.map((row) =>
          Object.fromEntries(
            Object.entries(row).sort(([a], [b]) => a.localeCompare(b)),
          ),
        ),
      );
    if (canonical(rows) !== canonical(localRows))
      throw new Error(
        `D1 verification mismatch in ${table}. No source records were changed.`,
      );
    report.push({
      table,
      count: rows.length,
      sha256: createHash("sha256").update(canonical(rows)).digest("hex"),
    });
  }
  db.close();
  fs.writeFileSync(
    path.join(local, `${environment}-d1-verification.json`),
    JSON.stringify(
      { database, verifiedAt: new Date().toISOString(), tables: report },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      verifiedD1: report.map(({ table, count }) => ({ table, count })),
    }),
  );
} else if (action === "artwork") {
  const root = path.resolve("data/uploads");
  let count = 0;
  const manifest = [];
  for (const name of fs.readdirSync(root)) {
    if (!/^[a-f0-9-]+\.(png|jpeg|webp)$/.test(name))
      throw new Error("Unexpected upload filename; migration stopped.");
    const file = path.join(root, name);
    cf([
      "r2",
      "objects",
      "put",
      prefix + name,
      "--bucket-name",
      bucket,
      "--file",
      file,
      "--content-type",
      name.endsWith("png")
        ? "image/png"
        : name.endsWith("jpeg")
          ? "image/jpeg"
          : "image/webp",
    ]);
    manifest.push({
      name,
      bytes: fs.statSync(file).size,
      sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
    });
    count++;
    console.log(`Copied artwork ${count}`);
  }
  fs.writeFileSync(
    path.join(local, `${environment}-artwork-manifest.json`),
    JSON.stringify(manifest, null, 2),
  );
  console.log(
    `Copied ${count} immutable artwork objects; no local files removed.`,
  );
} else if (action === "verify-artwork") {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(local, `${environment}-artwork-manifest.json`),
      "utf8",
    ),
  );
  const directory = path.join(local, `${environment}-r2-verification`);
  fs.mkdirSync(directory, { recursive: true });
  for (const object of manifest) {
    if (!/^[a-f0-9-]+\.(png|jpeg|webp)$/.test(object.name))
      throw new Error("Invalid manifest key.");
    const file = path.join(directory, object.name);
    const result = spawnSync(
      path.resolve("node_modules/node/bin/node.exe"),
      [
        "node_modules/wrangler/bin/wrangler.js",
        "--config",
        "wrangler.jsonc",
        "r2",
        "object",
        "get",
        `${bucket}/${prefix}${object.name}`,
        "--remote",
        "--file",
        file,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: account },
      },
    );
    if (result.status !== 0)
      throw new Error(
        `Could not download artwork ${object.name} for verification.`,
      );
    const bytes = fs.readFileSync(file);
    if (
      bytes.length !== object.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== object.sha256
    )
      throw new Error(
        `R2 integrity mismatch for ${object.name}; source files retained.`,
      );
    console.log(`Verified artwork ${object.name}`);
  }
  fs.writeFileSync(
    path.join(local, `${environment}-r2-verification.json`),
    JSON.stringify(
      {
        bucket,
        prefix,
        verifiedAt: new Date().toISOString(),
        objects: manifest,
      },
      null,
      2,
    ),
  );
  console.log(
    `Verified all ${manifest.length} R2 objects by download, size and SHA-256. Local originals retained.`,
  );
} else if (action === "secrets") {
  cf([
    "workers",
    "secrets",
    "bulk",
    "--worker",
    worker,
    "--secrets",
    `@${path.join(local, `${environment}-worker-secrets.json`)}`,
  ]);
  console.log(`${environment} secret bindings uploaded. Values withheld.`);
} else
  throw new Error(
    "Choose prepare, schema, metadata, verify, artwork, verify-artwork or secrets.",
  );
