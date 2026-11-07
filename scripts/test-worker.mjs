import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { pbkdf2Sync, createHash, createDecipheriv } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
const origin = "https://worker-test.example";
const password = "worker-test-owner-password",
  salt = "1234567890abcdef1234567890abcdef";
const root = path.resolve(".cloudflare/output/v0/workers/default/bundle");
const modules = [
  "index.js",
  ...readdirSync(root, { recursive: true }).filter(
    (f) => String(f).endsWith(".js") && f !== "index.js",
  ),
].map((file) => ({ type: "ESModule", path: path.join(root, String(file)) }));
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        modules,
        modulesRoot: root,
        compatibilityDate: "2026-11-06",
        compatibilityFlags: [
          "nodejs_compat",
          "nodejs_compat_populate_process_env",
        ],
        d1Databases: { DB: "test-db" },
        r2Buckets: ["ASSETS"],
        bindings: {
          APP_URL: origin,
          STORYBOOK_DEPLOYED: "1",
          SESSION_SECRET:
            "isolated-worker-session-secret-at-least-32-characters",
          OWNER_PASSWORD_HASH: `${salt}:${pbkdf2Sync(password, Buffer.from(salt, "hex"), 100000, 32, "sha256").toString("hex")}`,
          CANVA_CLIENT_ID: "fixture",
          CANVA_CLIENT_SECRET: "fixture",
          CANVA_REDIRECT_URI: `${origin}/auth/canva/callback`,
        },
        serviceBindings: {
          STATIC_ASSETS: async (request) =>
            new URL(request.url).pathname === "/globe.svg"
              ? new Response("Static binding is separate from private R2")
              : new Response("Not found", { status: 404 }),
        },
      },
    ],
  }),
);
try {
  const db = await mf.getD1Database("DB");
  await db.exec(
    "CREATE TABLE migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  // D1 exec is line-oriented; prepare().run() handles a trigger as one statement.
  for (const file of [
    "001-foundation.sql",
    "002-atomic-storage.sql",
    "003-canva-refresh.sql",
  ]) {
    const sql = readFileSync(`migrations/${file}`, "utf8").replace(
      /^--.*$/gm,
      "",
    );
    const trigger = sql.match(/CREATE TRIGGER[\s\S]*?END;/)?.[0];
    const rest = trigger ? sql.replace(trigger, "") : sql;
    for (const statement of rest
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await db.prepare(statement).run();
    if (trigger) await db.prepare(trigger).run();
  }
  const call = (route, init = {}) =>
    mf.dispatchFetch(origin + route, {
      ...init,
      headers: { Host: new URL(origin).host, ...init.headers },
    });
  const anonymous = await call("/api/workspace");
  assert.equal(anonymous.status, 401, await anonymous.clone().text());
  assert.equal(
    await (await call("/globe.svg")).text(),
    "Static binding is separate from private R2",
  );
  for (const route of [
    "/api/assets/private",
    "/api/books/private",
    "/api/jobs/private/advance",
  ])
    assert.equal(
      (
        await call(route, {
          method: route.includes("advance") ? "POST" : "GET",
          headers: { Origin: origin },
        })
      ).status,
      401,
    );
  const signed = await call("/login", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ password }),
    redirect: "manual",
  });
  assert.equal(signed.status, 303, await signed.clone().text());
  const cookie = signed.headers.get("set-cookie").split(";")[0];
  const headers = {
    Cookie: cookie,
    Origin: origin,
    "Content-Type": "application/json",
  };
  let workspace = await (await call("/api/workspace", { headers })).json();
  assert.equal(workspace.books.length, 1);
  assert.equal(workspace.connection.connected, false);
  const created = await call("/api/books", {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: "Workers persistence smoke",
      author: "",
      pageCount: 33,
    }),
  });
  const book = await created.json();
  assert.equal(created.status, 201, JSON.stringify(book));
  book.pages[0].text = "Persisted on D1";
  const saved = await call(`/api/books/${book.id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(book),
  });
  assert.equal(saved.status, 200, await saved.clone().text());
  workspace = await (await call("/api/workspace", { headers })).json();
  assert.equal(
    workspace.books.find((b) => b.id === book.id).pages[0].text,
    "Persisted on D1",
  );
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEo8AAAAASUVORK5CYII=",
    "base64",
  );
  const form = new FormData();
  form.set("file", new File([png], "page_1.png", { type: "image/png" }));
  const encoded = new Request(origin + "/api/assets", {
    method: "POST",
    body: form,
  });
  const uploaded = await call("/api/assets", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: origin,
      "Content-Type": encoded.headers.get("content-type"),
    },
    body: await encoded.arrayBuffer(),
  });
  const asset = await uploaded.json();
  assert.equal(uploaded.status, 201, JSON.stringify(asset));
  assert.equal(
    (await mf.getR2Bucket("ASSETS")).head
      ? !!(await (await mf.getR2Bucket("ASSETS")).head(asset.filename))
      : false,
    true,
  );
  const read = await call(`/api/assets/${asset.id}`, { headers });
  assert.equal(read.status, 200);
  assert.deepEqual(Buffer.from(await read.arrayBuffer()), png);
  assert.ok(read.headers.get("cache-control").includes("no-transform"));
  assert.equal(
    (await call(`/api/assets/${asset.id}`, { method: "DELETE", headers }))
      .status,
    200,
  );
  assert.equal(
    await (await mf.getR2Bucket("ASSETS")).head(asset.filename),
    null,
  );
  assert.equal(
    (await call(`/api/assets/${asset.id}`, { headers })).status,
    404,
  );
  // A multi-megabyte response must retain its exact size and bytes end to end.
  const large = Buffer.alloc(5 * 1024 * 1024, 0x6a);
  const largeAsset = {
    ...asset,
    id: "large-transfer-fixture",
    filename: "12345678-abcd-1234-abcd-123456789abc.png",
    size: large.length,
  };
  await (await mf.getR2Bucket("ASSETS")).put(largeAsset.filename, large);
  await db
    .prepare("INSERT INTO assets VALUES (?,?)")
    .bind(largeAsset.id, JSON.stringify(largeAsset))
    .run();
  const largeResponse = await call(`/api/assets/${largeAsset.id}`, { headers });
  assert.equal(largeResponse.status, 200);
  assert.deepEqual(Buffer.from(await largeResponse.arrayBuffer()), large);
  assert.ok(
    (await call(`/${largeAsset.filename}`)).headers
      .get("content-type")
      .includes("text/html"),
    "R2 objects cannot be read as public static files",
  );
  const rejected = await call(`/api/books/${book.id}`, {
    method: "PUT",
    headers: { ...headers, Origin: "https://attacker.example" },
    body: JSON.stringify(book),
  });
  assert.equal(rejected.status, 403);
  const connect = await call("/api/canva/connect", { method: "POST", headers });
  assert.equal(connect.status, 200);
  const authUrl = new URL((await connect.json()).url),
    state = authUrl.searchParams.get("state");
  assert.equal(
    authUrl.searchParams.get("redirect_uri"),
    `${origin}/auth/canva/callback`,
  );
  const stored = await db
    .prepare("SELECT encrypted FROM oauth_states WHERE id=?")
    .bind(createHash("sha256").update(state).digest("hex"))
    .first();
  const sealed = Buffer.from(stored.encrypted, "base64url");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    createHash("sha256")
      .update("isolated-worker-session-secret-at-least-32-characters")
      .digest(),
    sealed.subarray(0, 12),
  );
  decipher.setAuthTag(sealed.subarray(12, 28));
  const decoded = JSON.parse(
    Buffer.concat([
      decipher.update(sealed.subarray(28)),
      decipher.final(),
    ]).toString(),
  );
  assert.ok(decoded.verifier.length >= 43);
  const denied = await call(
    `/auth/canva/callback?state=${encodeURIComponent(state)}&error=access_denied`,
    { headers, redirect: "manual" },
  );
  assert.equal(denied.status, 303);
  assert.ok(denied.headers.get("location").includes("declined"));
  const callback = await call(
    "/auth/canva/callback?state=invalid&code=fixture",
    { headers, redirect: "manual" },
  );
  assert.equal(callback.status, 303);
  assert.ok(callback.headers.get("location").includes("error="));
  console.log(
    "Workers runtime passed: anonymous access denied, Web Crypto owner login, D1 create/save/reload, R2 upload/read, CSRF rejection, OAuth PKCE/AES-GCM state compatibility and rejection. No live Canva calls.",
  );
} finally {
  await mf.dispose();
}
