import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { createHash } from "node:crypto";
import {
  bookById,
  books,
  checkpoint,
  createBook,
  duplicateBook,
  get,
  initialize,
  list,
  preferences,
  put,
  saveBook,
  versions,
} from "../src/lib/repository";
import {
  consumeOAuthState,
  connection,
  disconnect,
  inspectTemplate,
  startOAuth,
  storeTokens,
  accessToken,
  canva,
  SCOPES,
} from "../src/lib/canva";
import {
  cookieValue,
  decrypt,
  encrypt,
  localBoundary,
  makeOwner,
  ownerCookie,
  pkce,
  requireOwner,
  validOwner,
} from "../src/lib/security";
import { storage } from "../src/lib/storage";
import { assetPath, readAsset, removeAsset, upload } from "../src/lib/assets";
import {
  buildAutofill,
  defaultMapping,
  distributeManuscript,
  validateBook,
  validateTemplate,
} from "../src/lib/validation";
import {
  advanceJob,
  publishingValidation,
  startPublishing,
} from "../src/lib/publishing";
import { bookEdit, preferencesSchema } from "../src/lib/schema";
import type { Asset, PublishJob, Template } from "../src/lib/types";
const testRoot = mkdtempSync(path.join(os.tmpdir(), "storybook-core-"));
process.env.STORYBOOK_DATA_DIR = testRoot;
process.env.SESSION_SECRET =
  "test-only-random-session-secret-at-least-32-characters";
process.env.APP_URL = "http://127.0.0.1:3000";
process.env.CANVA_CLIENT_ID = "test-client";
process.env.CANVA_CLIENT_SECRET = "test-secret";
process.env.CANVA_REDIRECT_URI = "http://127.0.0.1:3000/auth/canva/callback";
const originalFetch = globalThis.fetch;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
before(async () => await initialize());
test("migration and initial project persist without fabricated content", async () => {
  assert.equal((await storage().all("SELECT id FROM migrations")).length, 3);
  assert.equal((await books())[0].pages.length, 33);
  assert.ok((await books())[0].pages.every((p) => !p.text && !p.assetId));
  assert.equal((await list<Template>("templates"))[0].dataset, null);
  await initialize();
  assert.equal((await books()).length, 1);
});
test("books: create, edit, reorder, duplicate, archive and conflict protection", async () => {
  const book = await createBook("Test book", "Author", 24),
    first = book.pages[0].id;
  book.pages.reverse();
  book.pages[0].text = "A beginning.";
  const saved = await saveBook(book);
  assert.equal(saved.pages.at(-1)?.id, first);
  assert.equal((await bookById(book.id)).pages[0].text, "A beginning.");
  await assert.rejects(async () => await saveBook(book), /another tab/);
  const copy = await duplicateBook(book.id);
  assert.equal(copy.pages[0].text, "A beginning.");
  assert.notEqual(copy.pages[0].id, saved.pages[0].id);
  assert.equal(
    (await saveBook({ ...copy, status: "archived" })).status,
    "archived",
  );
});
test("draft checkpoints preserve the previous manuscript", async () => {
  const book = await createBook("Version test", "", 28);
  await checkpoint(book.id);
  await saveBook({
    ...book,
    pages: book.pages.map((p) => ({ ...p, text: "Revised" })),
  });
  assert.equal((await versions(book.id))[0].book.pages[0].text, "");
});
test("database content survives a separate process and module restart", () => {
  const script = path.join(process.cwd(), "tests", "persistence.mts");
  const env = {
    ...process.env,
    STORYBOOK_DATA_DIR: path.join(testRoot, "restart"),
  };
  const write = spawnSync(
    process.execPath,
    ["--import", "tsx", script, "write"],
    { env, encoding: "utf8" },
  );
  assert.equal(write.status, 0, write.stderr);
  const read = spawnSync(
    process.execPath,
    ["--import", "tsx", script, "read"],
    { env, encoding: "utf8" },
  );
  assert.equal(read.status, 0, read.stderr);
  assert.match(read.stdout, /persisted manuscript/);
});
test("PKCE uses fresh random verifier, SHA-256 challenge and state", () => {
  const p = pkce();
  assert.ok(p.verifier.length >= 43 && p.verifier.length <= 128);
  assert.equal(
    p.challenge,
    createHash("sha256").update(p.verifier).digest("base64url"),
  );
  assert.notEqual(p.state, pkce().state);
});
test("encrypted credentials authenticate ciphertext and never store plaintext", () => {
  const sealed = encrypt({ token: "private-access-token" });
  assert.ok(!sealed.includes("private-access-token"));
  assert.deepEqual(decrypt(sealed), { token: "private-access-token" });
  const modified = Buffer.from(sealed, "base64url");
  modified[30] ^= 1;
  assert.throws(() => decrypt(modified.toString("base64url")));
});
test("owner sessions, origin checks and DNS rebinding protection", () => {
  const owner = makeOwner();
  assert.ok(validOwner(owner));
  assert.ok(!validOwner(owner + "x"));
  assert.match(ownerCookie(owner), /HttpOnly; SameSite=Lax/);
  const request = new Request("http://127.0.0.1:3000/api/books", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      cookie: `sb_owner=${owner}`,
    },
  });
  assert.equal(requireOwner(request, true), owner);
  assert.equal(cookieValue(request), owner);
  assert.throws(
    () =>
      localBoundary(
        new Request(request, { headers: { host: "evil.test:3000" } }),
      ),
    /Remote access/,
  );
  assert.throws(
    () =>
      localBoundary(
        new Request(request, {
          headers: { host: "127.0.0.1:3000", origin: "https://evil.test" },
        }),
        true,
      ),
    /origin/,
  );
  assert.throws(
    () =>
      requireOwner(
        new Request(request, { headers: { host: "127.0.0.1:3000" } }),
      ),
    /session expired/,
  );
});
test("OAuth state is bound to the initiating owner, expires and cannot be replayed", async () => {
  const owner = makeOwner(),
    url = new URL(await startOAuth(owner)),
    state = url.searchParams.get("state")!;
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), SCOPES.join(" "));
  await assert.rejects(
    async () => await consumeOAuthState(state, makeOwner()),
    /state/,
  );
  assert.ok(await consumeOAuthState(state, owner));
  await assert.rejects(
    async () => await consumeOAuthState(state, owner),
    /state/,
  );
  const expired = new URL(await startOAuth(owner)).searchParams.get("state")!;
  await storage().run("UPDATE oauth_states SET expires_at=0");
  await assert.rejects(
    async () => await consumeOAuthState(expired, owner),
    /expired/,
  );
});
test("refresh rotation coalesces concurrent calls and revocation clears credentials", async () => {
  let refreshes = 0;
  await storeTokens({
    access_token: "expired",
    refresh_token: "first-refresh",
    expires_in: -1,
  });
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/oauth/token")) {
      refreshes++;
      assert.match(String(init?.body), /first-refresh/);
      return json({
        access_token: "rotated",
        refresh_token: "second-refresh",
        expires_in: 14400,
      });
    }
    assert.match(String(init?.body), /second-refresh/);
    return new Response(null, { status: 200 });
  };
  try {
    assert.deepEqual(await Promise.all([accessToken(), accessToken()]), [
      "rotated",
      "rotated",
    ]);
    assert.equal(refreshes, 1);
    await disconnect();
    assert.equal((await connection()).connected, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("API errors explain 401/403/404/429/5xx without echoing provider secrets", async () => {
  await storeTokens({
    access_token: "access",
    refresh_token: "refresh",
    expires_in: 14400,
  });
  try {
    for (const status of [401, 403, 404, 429, 500]) {
      globalThis.fetch = async () =>
        json({ message: "private-access-token" }, status);
      await assert.rejects(
        () => canva("/designs/example"),
        (e) => {
          assert.ok(e instanceof Error);
          assert.match(e.message, new RegExp(String(status)));
          assert.ok(!e.message.includes("private-access-token"));
          return true;
        },
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("template validation advises on mapping gaps and only blocks inaccessible datasets", () => {
  const template: Template = {
    id: "template-test",
    name: "Test",
    pageCount: 24,
    dataset: Object.fromEntries(
      defaultMapping(24).flatMap((m) => [
        [m.image, { type: "image" }],
        [m.text, { type: "text" }],
      ]),
    ),
    mapping: defaultMapping(24),
    checkedAt: new Date().toISOString(),
    error: null,
  };
  assert.equal(validateTemplate(template).errors.length, 0);
  assert.ok(
    validateTemplate(template, 33).warnings.some(
      (e) => e.code === "page_count",
    ),
  );
  assert.ok(
    validateTemplate({ ...template, dataset: null }).errors.some(
      (e) => e.code === "dataset",
    ),
  );
  const bad = structuredClone(template);
  bad.mapping[1].image = bad.mapping[0].image;
  bad.dataset![bad.mapping[0].text].type = "chart";
  bad.dataset!.EXTRA = { type: "text" };
  const result = validateTemplate(bad);
  assert.equal(result.errors.length, 0);
  assert.ok(result.warnings.some((e) => e.code === "duplicate"));
  assert.ok(result.warnings.some((e) => e.code === "field_type"));
  assert.ok(result.warnings.some((e) => e.code === "unmapped"));
});
test("manuscript import respects explicit page breaks and whole paragraphs", () => {
  assert.deepEqual(distributeManuscript("One\n---\nTwo", 3, "manual"), [
    "One",
    "Two",
    "",
  ]);
  assert.throws(
    () => distributeManuscript("A\n---\nB", 1, "manual"),
    /Nothing was imported/,
  );
  const paragraph = "One sentence. Another sentence.";
  const pages = distributeManuscript(
    [paragraph, "Second paragraph", "Third paragraph"].join("\n\n"),
    2,
    "paragraphs",
  );
  assert.ok(pages.some((p) => p.includes(paragraph)));
  assert.equal(
    pages.join("\n\n"),
    [paragraph, "Second paragraph", "Third paragraph"].join("\n\n"),
  );
});
test("input schemas reject unsafe dimensions, duplicate pages and unsupported counts", async () => {
  assert.equal(
    preferencesSchema.safeParse({
      ...(await preferences()),
      margin: 2,
      width: 2,
    }).success,
    false,
  );
  const book = await createBook("Schema", "", 24);
  assert.equal(
    bookEdit.safeParse({
      ...book,
      pages: [book.pages[0], ...book.pages.slice(0, 23)],
    }).success,
    false,
  );
  assert.equal(
    bookEdit.safeParse({ ...book, pages: book.pages.slice(1) }).success,
    false,
  );
});
test("uploads validate decoded formats, reject traversal and protect referenced assets", async () => {
  const bytes = await sharp({
    create: { width: 2600, height: 2700, channels: 3, background: "#b9c99b" },
  })
    .png()
    .toBuffer();
  const asset = await upload(
    new File([new Uint8Array(bytes)], "Illustration.png", {
      type: "image/png",
    }),
  );
  assert.equal(asset.width, 2600);
  assert.ok((await readAsset(asset)).length);
  assert.throws(() => assetPath("../../.env.local"), /Invalid asset path/);
  await assert.rejects(
    () => upload(new File(["not an image"], "bad.png", { type: "image/png" })),
    /decoded/,
  );
  await assert.rejects(
    () => upload(new File(["<svg/>"], "bad.svg", { type: "image/svg+xml" })),
    /Supported formats/,
  );
  const book = await createBook("Asset protection", "", 24);
  await saveBook({
    ...book,
    pages: book.pages.map((p) => ({ ...p, assetId: asset.id })),
  });
  await assert.rejects(() => removeAsset(asset.id), /referenced/);
  const replacement = await upload(
    new File([new Uint8Array(bytes)], "replacement.png", { type: "image/png" }),
    asset.id,
  );
  assert.equal(replacement.id, asset.id);
  assert.notEqual(replacement.filename, asset.filename);
  assert.ok(readFileSync(assetPath(asset.filename)).length);
});
test("publishing readiness keeps creative issues advisory", async () => {
  const book = await createBook("Readiness", "", 24),
    asset = (await list<Asset>("assets"))[0];
  const result = validateBook(book, undefined, [], false, 300);
  assert.ok(result.errors.some((e) => e.code === "connection"));
  assert.ok(result.warnings.some((e) => e.code === "image"));
  assert.ok(result.warnings.some((e) => e.code === "text"));
  assert.ok(result.warnings.length);
  book.pages = book.pages.map((p) => ({
    ...p,
    text: "Story copy",
    assetId: asset.id,
  }));
  assert.ok(
    validateBook(book, undefined, [asset], true, 600).warnings.some(
      (e) => e.code === "resolution",
    ),
  );
});
test("live dataset inspection uses actual server responses and records access errors", async () => {
  const template = (await list<Template>("templates"))[0];
  await storeTokens({
    access_token: "access",
    refresh_token: "refresh",
    expires_in: 14400,
  });
  globalThis.fetch = async (url) =>
    String(url).endsWith("/dataset")
      ? json({ dataset: { ACTUAL_FIELD: { type: "text" } } })
      : json({ design: { title: "Actual design", page_count: 33 } });
  try {
    const result = await inspectTemplate(template.id);
    assert.deepEqual(Object.keys(result.dataset!), ["ACTUAL_FIELD"]);
    assert.equal(result.pageCount, 33);
    globalThis.fetch = async () => json({}, 403);
    await assert.rejects(() => inspectTemplate(template.id), /403/);
    assert.match(
      (await get<Template>("templates", template.id))!.error!,
      /403/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("publishing uploads, polls, autofills a new design, verifies count and saves confirmed result", async () => {
  const book = await createBook("Publish workflow", "", 24),
    asset = (await list<Asset>("assets"))[0],
    mapping = defaultMapping(24);
  const template: Template = {
    id: "DAHaJgBbCJ4",
    name: "Publish template",
    pageCount: 24,
    mapping,
    dataset: Object.fromEntries(
      mapping.flatMap((m) => [
        [m.image, { type: "image" }],
        [m.text, { type: "text" }],
      ]),
    ),
    checkedAt: new Date().toISOString(),
    error: null,
  };
  await put("templates", template.id, template);
  await saveBook({
    ...book,
    templateId: template.id,
    pages: book.pages.map((p) => ({
      ...p,
      text: "The story begins.",
      assetId: asset.id,
    })),
  });
  let uploadPosts = 0,
    autofillPosts = 0,
    autofillPolls = 0;
  globalThis.fetch = async (url, init) => {
    const endpoint = String(url);
    if (endpoint.endsWith("/dataset"))
      return json({ dataset: template.dataset });
    if (endpoint.endsWith("/designs/DAHaJgBbCJ4"))
      return json({ design: { title: template.name, page_count: 24 } });
    if (endpoint.endsWith("/asset-uploads")) {
      uploadPosts++;
      assert.ok(init?.body instanceof Uint8Array);
      return json({ job: { id: "upload-1", status: "in_progress" } });
    }
    if (endpoint.endsWith("/asset-uploads/upload-1"))
      return json({
        job: {
          id: "upload-1",
          status: "success",
          asset: { id: "canva-asset" },
        },
      });
    if (endpoint.endsWith("/autofills")) {
      autofillPosts++;
      const payload = JSON.parse(init!.body as string);
      assert.equal(payload.type, "create_from_design");
      assert.equal(payload.design_id, "DAHaJgBbCJ4");
      assert.equal(Object.keys(payload.data).length, 48);
      assert.equal(payload.data.PAGE_01_IMAGE.asset_id, "canva-asset");
      return json({ job: { id: "autofill-1", status: "in_progress" } });
    }
    if (endpoint.endsWith("/autofills/autofill-1")) {
      autofillPolls++;
      return autofillPolls === 1
        ? json({ job: { id: "autofill-1", status: "in_progress" } })
        : json({
            job: {
              id: "autofill-1",
              status: "success",
              result: {
                type: "create_design",
                design: {
                  id: "new-design",
                  urls: {
                    edit_url: "https://www.canva.com/design/new-design/edit",
                  },
                },
              },
            },
          });
    }
    if (endpoint.endsWith("/designs/new-design"))
      return json({
        design: {
          id: "new-design",
          page_count: 24,
          urls: { edit_url: "https://www.canva.com/design/new-design/edit" },
        },
      });
    throw new Error("Unexpected endpoint " + endpoint);
  };
  try {
    const summary = await startPublishing(book.id);
    assert.equal(summary.status, "queued");
    for (let i = 0; i < 6; i++) {
      const job = (await get<PublishJob>("publishing_jobs", summary.id))!;
      job.nextAt = 0;
      await storage().run(
        "UPDATE publishing_jobs SET document=? WHERE id=?",
        JSON.stringify(job),
        job.id,
      );
      await advanceJob(job.id);
    }
    const job = (await get<PublishJob>("publishing_jobs", summary.id))!;
    assert.equal(job.status, "success");
    assert.equal(job.designId, "new-design");
    assert.equal(uploadPosts, 1);
    assert.equal(autofillPosts, 1);
    assert.equal(
      (await storage().all("SELECT * FROM generated_designs")).length,
      1,
    );
    assert.equal(
      buildAutofill(job.snapshot.book, job.snapshot.template, job.uploaded)
        .type,
      "create_from_design",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("interrupted POST is not replayed, and failed remote jobs never report success", async () => {
  const previous = (await list<PublishJob>("publishing_jobs"))[0];
  const job = {
    ...previous,
    id: "interrupted-test",
    status: "generating" as const,
    remoteId: "uncertain",
    designId: undefined,
    designUrl: undefined,
    nextAt: 0,
  };
  await storage().run(
    "INSERT INTO publishing_jobs (id,book_id,document) VALUES (?, ?, ?)",
    job.id,
    job.bookId,
    JSON.stringify(job),
  );
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw new Error("Must not fetch");
  };
  try {
    const result = await advanceJob(job.id);
    assert.equal(result.status, "failed");
    assert.equal(requests, 0);
    assert.match(result.message, /will not be replayed/);
    const failed = { ...job, id: "remote-fail", remoteId: "failed-remote" };
    await storage().run(
      "INSERT INTO publishing_jobs (id,book_id,document) VALUES (?, ?, ?)",
      failed.id,
      failed.bookId,
      JSON.stringify(failed),
    );
    globalThis.fetch = async () =>
      json({
        job: {
          id: "failed-remote",
          status: "failed",
          error: { code: "invalid_data", message: "failure" },
        },
      });
    const result2 = await advanceJob(failed.id);
    assert.equal(result2.status, "failed");
    assert.match(result2.message, /invalid_data/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("preflight detects illustration files changed outside the application", async () => {
  const asset = (await list<Asset>("assets"))[0];
  const book = await createBook("File integrity", "", 24);
  await saveBook({
    ...book,
    pages: book.pages.map((p) => ({ ...p, text: "Copy", assetId: asset.id })),
  });
  const filename = assetPath(asset.filename),
    original = readFileSync(filename);
  try {
    writeFileSync(filename, "changed outside app");
    const result = await publishingValidation(book.id);
    assert.ok(result.warnings.some((e) => e.code === "unavailable_image"));
  } finally {
    writeFileSync(filename, original);
  }
});
