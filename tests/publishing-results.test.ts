import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { partialFixture } from "./fixtures/partial-book";
import { createBook, get, saveJob, put } from "../src/lib/repository";
import { advanceJob, recheckJob, jobSummary } from "../src/lib/publishing";
import { storeTokens } from "../src/lib/canva";
import { storage } from "../src/lib/storage";
import type { PublishJob } from "../src/lib/types";
process.env.STORYBOOK_DATA_DIR = mkdtempSync(
  path.join(os.tmpdir(), "storybook-results-"),
);
process.env.SESSION_SECRET =
  "isolated-result-test-secret-with-at-least-32-characters";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
async function fixture() {
  const { book, template } = partialFixture();
  const local = await createBook("Result verification", "", 33);
  const stamp = new Date().toISOString();
  const job: PublishJob = {
    id: randomUUID(),
    bookId: local.id,
    title: local.title,
    status: "generating",
    progress: 75,
    message: "Generating",
    createdAt: stamp,
    updatedAt: stamp,
    nextAt: 0,
    attempts: 0,
    remoteId: "known-job",
    uploaded: {},
    snapshot: { book, template, assets: [], dpi: 300 },
  };
  await saveJob(job);
  await storeTokens({
    access_token: "fixture",
    refresh_token: "fixture",
    expires_in: 14400,
  });
  return job;
}
function successful(id = "created-design") {
  return {
    job: {
      id: "known-job",
      status: "success",
      result: { type: "create_design", design: { id } },
    },
  };
}
function mock(
  result: unknown,
  metaId = "created-design",
  url = "https://www.canva.com/design/created-design/edit",
) {
  globalThis.fetch = async (urlValue, init) => {
    assert.ok(
      !init?.method || init.method === "GET",
      "recovery must never create or update a design",
    );
    return String(urlValue).includes("/autofills/")
      ? json(result)
      : json({
          design: { id: metaId, page_count: 33, urls: { edit_url: url } },
        });
  };
}
test("legacy success without result evidence is shown as needing recovery without changing the record", async () => {
  const job = { ...(await fixture()), status: "success" as const };
  await saveJob(job);
  const summary = jobSummary(job);
  assert.equal(summary.status, "failed");
  assert.match(summary.message, /Stored completion is missing/);
  assert.equal(
    (await get<PublishJob>("publishing_jobs", job.id))!.status,
    "success",
  );
});
for (const [name, response] of [
  ["missing job", {}],
  ["numeric job ID", { job: { id: 42, status: "success" } }],
  ["wrong job ID", { job: { ...successful().job, id: "another-job" } }],
  [
    "missing design ID",
    {
      job: {
        id: "known-job",
        status: "success",
        result: { type: "create_design", design: {} },
      },
    },
  ],
  ["missing result", { job: { id: "known-job", status: "success" } }],
  [
    "unexpected result type",
    {
      job: {
        ...successful().job,
        result: { ...successful().job.result, type: "update_design" },
      },
    },
  ],
  ["protected master result", successful("DAHaJgBbCJ4")],
  [
    "failed job",
    {
      job: {
        id: "known-job",
        status: "failed",
        error: { code: "invalid_data", message: "private content" },
      },
    },
  ],
] as const) {
  test(`${name} cannot produce false-positive completion`, async () => {
    const job = await fixture();
    mock(response);
    const before = (await storage().all("SELECT * FROM generated_designs"))
      .length;
    const result = await advanceJob(job.id);
    assert.equal(result.status, "failed");
    assert.equal(result.designId, undefined);
    assert.equal(result.completedAt, undefined);
    assert.equal(
      (await storage().all("SELECT * FROM generated_designs")).length,
      before,
    );
    assert.ok(!result.message.includes("private content"));
  });
}
test("pending is not complete, and known-job recovery confirms the result without POSTs", async () => {
  const job = await fixture();
  mock({ job: { id: "known-job", status: "in_progress" } });
  const pending = await advanceJob(job.id);
  assert.equal(pending.status, "generating");
  assert.equal(pending.designId, undefined);
  mock(successful());
  const recovered = await recheckJob(job.id);
  assert.equal(recovered.status, "success");
  assert.equal(recovered.operation, "create_from_design");
  assert.equal(recovered.resultType, "create_design");
  assert.equal(recovered.designId, "created-design");
  assert.ok(recovered.confirmedAt && recovered.completedAt);
  assert.match(recovered.message, /CREATED.*not updated/);
});
test("mismatched metadata and misleading URLs fail verification", async () => {
  for (const [id, url] of [
    ["wrong-design", "https://www.canva.com/design/created-design/edit"],
    ["created-design", "https://www.canva.com.evil.example/design/x/edit"],
    ["created-design", "https://www.canva.com/"],
  ]) {
    const job = await fixture();
    mock(successful(), id, url);
    assert.equal((await advanceJob(job.id)).status, "failed");
  }
});
test("malformed JSON cannot complete a job and recoverable provider errors do not leak raw messages", async () => {
  const job = await fixture();
  globalThis.fetch = async () => new Response("<html>not a job</html>");
  const invalid = await advanceJob(job.id);
  assert.equal(invalid.status, "failed");
  assert.match(invalid.message, /malformed JSON/);
  globalThis.fetch = async () =>
    json(
      {
        code: "bad_request_params",
        message: "private manuscript and access token",
      },
      400,
    );
  await assert.rejects(
    () => recheckJob(job.id),
    (error) => {
      assert.match((error as Error).message, /400.*bad_request_params/);
      assert.ok(!(error as Error).message.includes("private manuscript"));
      return true;
    },
  );
});
test("failed polling stays incomplete, is bounded, and can recover the same remote job", async () => {
  const job = await fixture();
  globalThis.fetch = async () => json({ code: "rate_limited" }, 429);
  const retrying = await advanceJob(job.id);
  assert.equal(retrying.status, "generating");
  assert.equal(retrying.designId, undefined);
  assert.match(retrying.message, /rate_limited.*Retrying status check/);
  await saveJob({
    ...(await get<PublishJob>("publishing_jobs", job.id))!,
    attempts: 40,
    nextAt: 0,
  });
  assert.equal((await advanceJob(job.id)).status, "failed");
  mock(successful());
  assert.equal((await recheckJob(job.id)).status, "success");
});
test("failed link refresh preserves earlier completion and uncertain submissions are never replayed", async () => {
  const job = await fixture();
  mock(successful());
  await recheckJob(job.id);
  const before = await get<PublishJob>("publishing_jobs", job.id);
  globalThis.fetch = async () => json({ code: "not_found" }, 404);
  await assert.rejects(() => recheckJob(job.id), /404.*not_found/);
  assert.deepEqual(await get<PublishJob>("publishing_jobs", job.id), before);
  await saveJob({ ...job, status: "failed", remoteId: "uncertain" });
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw new Error("must not submit");
  };
  await assert.rejects(() => recheckJob(job.id), /will not be replayed/);
  assert.equal(requests, 0);
});

test("refreshing a completed historical result preserves the owner's active draft", async () => {
  const job = await fixture();
  mock(successful());
  await recheckJob(job.id);
  await put("settings", `active-draft:${job.bookId}`, {
    designId: "explicit-owner-selection",
  });
  await recheckJob(job.id);
  assert.equal(
    (await get<{ designId: string }>("settings", `active-draft:${job.bookId}`))!
      .designId,
    "explicit-owner-selection",
  );
});
