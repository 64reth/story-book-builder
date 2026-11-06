import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { partialFixture } from "./fixtures/partial-book";
import {
  buildAutofill,
  planAutofill,
  validateBook,
  validateTemplate,
} from "../src/lib/validation";
import { createBook, get, put, saveBook, saveJob } from "../src/lib/repository";
import {
  startPublishing,
  advanceJob,
  publishingValidation,
} from "../src/lib/publishing";
import { storeTokens } from "../src/lib/canva";
import { assetPath } from "../src/lib/assets";
import type { PublishJob } from "../src/lib/types";
process.env.STORYBOOK_DATA_DIR = mkdtempSync(
  path.join(os.tmpdir(), "storybook-partial-"),
);
process.env.SESSION_SECRET =
  "test-only-partial-autofill-session-secret-with-32-characters";
process.env.APP_URL = "http://127.0.0.1:3000";
process.env.CANVA_CLIENT_ID = "test-client";
process.env.CANVA_CLIENT_SECRET = "test-secret";
process.env.CANVA_REDIRECT_URI = "http://127.0.0.1:3000/auth/canva/callback";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const mismatch =
  "Page 12 text could not be mapped because PAGE_12_TEXT is an image field. Correct the label in Canva to include this text automatically.";

test("wrong Page 12 type is skipped once while every valid field remains in the partial payload", () => {
  const { book, template, assets } = partialFixture(),
    validation = validateBook(book, template, assets, true, 300);
  assert.equal(validation.errors.length, 0);
  assert.equal(
    validation.warnings.filter((i) => i.code === "field_type").length,
    1,
  );
  assert.equal(
    validation.warnings.find((i) => i.code === "field_type")!.message,
    mismatch,
  );
  assert.deepEqual(validation.submission, { textFields: 26, imageFields: 33 });
  const before = JSON.stringify(template),
    payload = buildAutofill(
      book,
      template,
      Object.fromEntries(assets.map((a) => [a.id, `remote-${a.id}`])),
    );
  assert.equal(payload.type, "create_from_design");
  assert.equal(payload.design_id, template.id);
  assert.equal(Object.keys(payload.data).length, 59);
  assert.ok(!Object.hasOwn(payload.data, "PAGE_12_TEXT"));
  for (let n = 1; n <= 33; n++) {
    const prefix = `PAGE_${String(n).padStart(2, "0")}`;
    assert.equal(payload.data[`${prefix}_IMAGE`].type, "image");
    if (n <= 27 && n !== 12)
      assert.equal(payload.data[`${prefix}_TEXT`].type, "text");
    else assert.ok(!Object.hasOwn(payload.data, `${prefix}_TEXT`));
  }
  assert.equal(JSON.stringify(template), before);
  assert.equal(
    validation.skipped!.find((f) => f.field === "PAGE_12_TEXT")!.populated,
    true,
  );
  assert.deepEqual(
    validation.skipped!.map((f) => f.field),
    [
      "PAGE_12_TEXT",
      ...Array.from({ length: 6 }, (_, i) => `PAGE_${i + 28}_TEXT`),
    ],
  );
});

test("33 low-DPI illustrations and six blank texts produce grouped advisories with collapsed diagnostics data", () => {
  const { book, template, assets } = partialFixture(),
    result = validateBook(book, template, assets, true, 300);
  assert.equal(
    result.warnings.filter((i) => i.code === "resolution").length,
    1,
  );
  assert.equal(
    result.warnings.find((i) => i.code === "resolution")!.message,
    "33 illustrations are below the 300 DPI print target (101–144 DPI). Review before final print export.",
  );
  assert.equal(
    result.details!.filter((i) => i.code === "resolution").length,
    33,
  );
  assert.equal(
    result.warnings.find((i) => i.code === "text")!.message,
    "6 pages have no manuscript text (28–33).",
  );
  assert.ok(
    !result.errors.some((i) =>
      ["resolution", "text", "image", "field_type"].includes(i.code),
    ),
  );
});

test("missing artwork, overflow, aspect ratios and page-count mismatch remain advisory", () => {
  const { book, template, assets } = partialFixture();
  book.pages[0].assetId = null;
  book.pages[1].text = "Long copy ".repeat(80);
  assets[2].width = 2000;
  const result = validateBook(
    book,
    { ...template, pageCount: 32 },
    assets,
    true,
    300,
  );
  assert.equal(result.errors.length, 0);
  for (const code of ["image", "length", "aspect", "page_count"])
    assert.ok(result.warnings.some((i) => i.code === code));
  assert.ok(
    !planAutofill(book, template, assets).fields.some(
      (f) => f.field === "PAGE_01_IMAGE",
    ),
  );
});

test("ambiguous duplicates and unmapped fields cannot overwrite populated content", () => {
  const { book, template, assets } = partialFixture();
  template.mapping[1].image = template.mapping[0].image;
  template.dataset!.EXTRA = { type: "text" };
  const result = validateBook(book, template, assets, true, 300);
  assert.equal(result.errors.length, 0);
  const plan = planAutofill(book, template, assets);
  assert.ok(!plan.fields.some((f) => f.field === "PAGE_01_IMAGE"));
  assert.equal(
    plan.skipped.filter((f) => f.field === "PAGE_01_IMAGE" && f.populated)
      .length,
    2,
  );
  assert.ok(plan.skipped.some((f) => f.field === "EXTRA"));
});

test("no compatible populated content and inaccessible datasets are recoverable technical errors", () => {
  const { book, template } = partialFixture();
  book.pages = book.pages.map((p) => ({ ...p, text: "", assetId: null }));
  assert.ok(
    validateBook(book, template, [], true, 300).errors.some(
      (i) => i.code === "no_data",
    ),
  );
  assert.throws(
    () => buildAutofill(book, template, {}),
    /No supported, populated/,
  );
  assert.ok(
    validateTemplate({
      ...template,
      error: "Canva returned 403. Check permissions.",
    }).errors.some((i) => i.code === "dataset"),
  );
});

let completedJob: PublishJob;
test("the durable publishing workflow uploads and generates a partial new design without source mutation", async () => {
  const { book: fixture, template, assets } = partialFixture();
  const created = createBook(fixture.title, "", 33);
  fixture.id = created.id;
  fixture.createdAt = created.createdAt;
  put("templates", template.id, template);
  for (const asset of assets) {
    writeFileSync(assetPath(asset.filename), "x");
    put("assets", asset.id, asset);
  }
  saveBook(fixture);
  storeTokens({
    access_token: "test-access",
    refresh_token: "test-refresh",
    expires_in: 14400,
  });
  let uploads = 0,
    autofills = 0;
  const calls: { method: string; url: string }[] = [];
  globalThis.fetch = async (url, init) => {
    const endpoint = String(url),
      method = init?.method ?? "GET";
    calls.push({ method, url: endpoint });
    if (endpoint.endsWith("/dataset"))
      return json({ dataset: template.dataset });
    if (endpoint.endsWith(`/designs/${template.id}`))
      return json({ design: { title: template.name, page_count: 33 } });
    if (endpoint.endsWith("/asset-uploads")) {
      uploads++;
      return json({ job: { id: `upload-${uploads}`, status: "in_progress" } });
    }
    if (endpoint.includes("/asset-uploads/"))
      return json({
        job: {
          id: endpoint.split("/").at(-1),
          status: "success",
          asset: { id: `remote-${endpoint.split("/").at(-1)}` },
        },
      });
    if (endpoint.endsWith("/autofills")) {
      autofills++;
      const payload = JSON.parse(init!.body as string);
      assert.equal(payload.type, "create_from_design");
      assert.equal(Object.keys(payload.data).length, 59);
      assert.ok(!payload.data.PAGE_12_TEXT);
      assert.ok(!payload.data.PAGE_28_TEXT);
      return json({ job: { id: "partial-job", status: "in_progress" } });
    }
    if (endpoint.endsWith("/autofills/partial-job"))
      return json({
        job: {
          id: "partial-job",
          status: "success",
          result: {
            type: "create_design",
            design: {
              id: "partial-new",
              urls: {
                edit_url: "https://www.canva.com/design/partial-new/edit",
              },
            },
          },
        },
      });
    if (endpoint.endsWith("/designs/partial-new"))
      return json({
        design: {
          id: "partial-new",
          page_count: 33,
          urls: { edit_url: "https://www.canva.com/design/partial-new/edit" },
        },
      });
    throw new Error("Unexpected request");
  };
  const summary = await startPublishing(fixture.id);
  assert.equal(summary.validation?.skipped?.length, 7);
  for (let n = 0; n < 75; n++) {
    const job = get<PublishJob>("publishing_jobs", summary.id)!;
    if (job.status === "success" || job.status === "failed") break;
    job.nextAt = 0;
    saveJob(job);
    await advanceJob(job.id);
  }
  completedJob = get<PublishJob>("publishing_jobs", summary.id)!;
  assert.equal(completedJob.status, "success");
  assert.equal(uploads, 33);
  assert.equal(autofills, 1);
  assert.equal(
    completedJob.validation!.skipped!.find((f) => f.field === "PAGE_12_TEXT")!
      .populated,
    true,
  );
  assert.ok(
    calls.every(
      (c) =>
        c.method === "GET" ||
        (c.method === "POST" && /\/(asset-uploads|autofills)$/.test(c.url)),
    ),
  );
});

test("a genuine Canva partial-request rejection fails clearly without retrying as a source update", async () => {
  const job: PublishJob = {
    ...completedJob,
    id: randomUUID(),
    status: "uploading",
    remoteId: undefined,
    nextAt: 0,
    designId: undefined,
    designUrl: undefined,
  };
  saveJob(job);
  const methods: string[] = [];
  globalThis.fetch = async (_url, init) => {
    methods.push(init!.method!);
    return json({ code: "bad_request_params" }, 400);
  };
  const result = await advanceJob(job.id);
  assert.equal(result.status, "failed");
  assert.match(result.message, /Canva returned 400/);
  assert.match(result.message, /dataset types/);
  assert.deepEqual(methods, ["POST"]);
});

test("inaccessible live Canva source blocks generation with a recoverable technical message", async () => {
  globalThis.fetch = async () => json({}, 403);
  const result = await publishingValidation(completedJob.bookId, true);
  assert.ok(result.errors.some((i) => i.message.includes("403")));
  await assert.rejects(() => startPublishing(completedJob.bookId), /403/);
});
