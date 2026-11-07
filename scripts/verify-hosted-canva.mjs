// Read-only Canva verification through authenticated application endpoints.
// Only existing job status checks: never submit or advance a publishing job.
import fs from "node:fs";
import assert from "node:assert/strict";
const environment = process.argv.includes("--production")
  ? "production"
  : "staging";
const access = JSON.parse(
  fs.readFileSync(`.local/${environment}-owner-access.json`, "utf8"),
);
const origin =
  environment === "production"
    ? "https://storybookbuilder.allencreativetechnologies.uk"
    : "https://story-book-builder-staging.garetha81.workers.dev";
assert.equal(access.url, origin);
const login = await fetch(origin + "/login", {
  method: "POST",
  headers: { Origin: origin },
  body: new URLSearchParams({ password: access.password }),
  redirect: "manual",
});
assert.equal(login.status, 303);
const headers = {
  Cookie: login.headers.get("set-cookie").split(";")[0],
  Origin: origin,
};
const call = async (path, method = "GET") => {
  const response = await fetch(origin + path, { method, headers });
  const value = await response.json();
  return { status: response.status, value };
};
const workspace = await call("/api/workspace");
assert.equal(workspace.status, 200);
assert.equal(
  workspace.value.connection.connected,
  true,
  "Hosted Canva consent is required.",
);
const source = await call("/api/templates/DAHaJgBbCJ4/inspect", "POST");
assert.equal(source.status, 200, JSON.stringify(source.value));
assert.equal(source.value.id, "DAHaJgBbCJ4");
const validation = [],
  records = [];
for (const book of workspace.value.books.filter(
  (book) => book.status !== "archived",
)) {
  const checked = await call(`/api/books/${book.id}/validate`, "POST");
  assert.equal(checked.status, 200, JSON.stringify(checked.value));
  validation.push({ bookId: book.id, ...checked.value });
}
for (const job of workspace.value.jobs) {
  const checked = await call(`/api/jobs/${job.id}/recheck`, "POST");
  records.push({ jobId: job.id, ...checked });
}
const evidence = {
  origin,
  verifiedAt: new Date().toISOString(),
  connected: true,
  source: {
    id: source.value.id,
    pageCount: source.value.pageCount,
    fields: Object.keys(source.value.dataset ?? {}).length,
    page12: source.value.dataset?.PAGE_12_TEXT,
  },
  validation,
  records,
};
fs.writeFileSync(
  `.local/${environment}-canva-verification.json`,
  JSON.stringify(evidence, null, 2),
);
console.log(
  JSON.stringify({
    connected: true,
    source: evidence.source,
    validation: validation.map((item) => ({
      bookId: item.bookId,
      technicalErrors: item.errors,
      advisories: item.warnings?.length,
    })),
    records: records.map((item) => ({
      jobId: item.jobId,
      httpStatus: item.status,
      status: item.value.status,
      designId: item.value.designId,
      message: item.value.message,
      error: item.value.error,
    })),
  }),
);
