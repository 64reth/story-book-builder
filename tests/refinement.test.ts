import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { partialFixture } from "./fixtures/partial-book";
import { createBook, get, put, saveBook, saveJob } from "../src/lib/repository";
import {
  fieldManifest,
  refinementPlan,
  selectDraft,
  activeDraft,
  MASTER,
} from "../src/lib/refinement";
import { advanceJob, startPublishing } from "../src/lib/publishing";
import { storeTokens } from "../src/lib/canva";
import { planAutofill } from "../src/lib/validation";
import type { PublishJob } from "../src/lib/types";
process.env.STORYBOOK_DATA_DIR = mkdtempSync(
  path.join(os.tmpdir(), "storybook-refine-"),
);
process.env.SESSION_SECRET =
  "isolated-refinement-test-secret-at-least-32-characters";
const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});
const json = (v: unknown) => new Response(JSON.stringify(v));
test("explicit draft selection, no-change detection, changed-only partial updates, and matching completion", async () => {
  const { book, template, assets } = partialFixture();
  const local = createBook(book.title, "", 33);
  book.id = local.id;
  put("templates", template.id, template);
  assets.forEach((a) => put("assets", a.id, a));
  saveBook(book);
  storeTokens({
    access_token: "fixture",
    refresh_token: "fixture",
    expires_in: 14400,
  });
  const fields = planAutofill(book, template, assets).fields,
    stamp = new Date().toISOString();
  const previous: PublishJob = {
    id: "prior",
    bookId: book.id,
    title: book.title,
    status: "success",
    message: "Created",
    createdAt: stamp,
    updatedAt: stamp,
    nextAt: 0,
    attempts: 0,
    progress: 100,
    remoteId: "previous",
    designId: "generated",
    designUrl: "https://www.canva.com/design/generated/edit",
    snapshot: { book, template, assets, fields, dpi: 300 },
    uploaded: {},
    manifest: fieldManifest(fields, assets),
  };
  saveJob(previous);
  assert.equal(activeDraft(book.id), undefined);
  let posts = 0;
  globalThis.fetch = async (url, init) => {
    const endpoint = String(url);
    if (init?.method === "POST") {
      posts++;
      const p = JSON.parse(init.body as string);
      assert.equal(p.type, "update_design");
      assert.equal(p.design_id, "generated");
      assert.deepEqual(Object.keys(p.data), ["PAGE_01_TEXT"]);
      return json({ job: { id: "update-job", status: "in_progress" } });
    }
    if (endpoint.endsWith("/users/me"))
      return json({ team_user: { user_id: "owner", team_id: "team" } });
    if (endpoint.endsWith("/dataset"))
      return json({ dataset: template.dataset });
    if (endpoint.endsWith("/autofills/update-job"))
      return json({
        job: {
          id: "update-job",
          status: "success",
          result: { type: "update_design", design: { id: "generated" } },
        },
      });
    return json({
      design: {
        id: "generated",
        owner: { user_id: "owner", team_id: "team" },
        page_count: 33,
        urls: { edit_url: "https://www.canva.com/design/generated/edit" },
      },
    });
  };
  await assert.rejects(() => selectDraft(book.id, MASTER), /protected master/);
  await selectDraft(book.id, "generated");
  assert.equal((await refinementPlan(book.id)).fields.length, 0);
  await assert.rejects(
    () =>
      startPublishing(book.id, "update_design", {
        fields: [],
        revision: 1,
        designId: "generated",
      }),
    /No fields have changed/,
  );
  const current = getBook();
  current.pages[0].text = "Revised opening";
  saveBook(current);
  const plan = await refinementPlan(book.id);
  assert.deepEqual(
    plan.fields.map((f) => f.field),
    ["PAGE_01_TEXT"],
  );
  await assert.rejects(
    () => startPublishing(book.id, "update_design"),
    /Review the current affected fields/,
  );
  const job = await startPublishing(book.id, "update_design", {
    fields: plan.fields.map((f) => f.field),
    revision: plan.revision,
    designId: plan.designId,
  });
  await advanceJob(job.id);
  const pending = get<PublishJob>("publishing_jobs", job.id)!;
  pending.nextAt = 0;
  saveJob(pending);
  const done = await advanceJob(job.id);
  assert.equal(done.status, "success");
  assert.equal(done.resultType, "update_design");
  assert.equal(done.designId, "generated");
  assert.equal(posts, 1);
  function getBook() {
    return { ...book, revision: 1, pages: book.pages.map((p) => ({ ...p })) };
  }
});
