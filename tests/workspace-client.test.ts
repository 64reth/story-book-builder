import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadWorkspace } from "../src/lib/workspace-client";
import type { Workspace } from "../src/lib/types";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const workspace: Workspace = {
  books: [],
  assets: [],
  templates: [],
  jobs: [],
  preferences: {
    width: 8.625,
    height: 8.7,
    margin: 0.375,
    font: "Lilita One",
    dpi: 300,
    exportFormat: "pdf_print",
    theme: "light",
  },
  connection: {
    connected: false,
    configured: false,
    missing: ["CANVA_CLIENT_SECRET"],
  },
  storage: { bytes: 0, assets: 0 },
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
test("empty workspace loads without Canva credentials or authorization", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/workspace");
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal);
    return json(workspace);
  };
  assert.deepEqual(await loadWorkspace(), workspace);
});
test("workspace HTTP failures preserve an actionable message", async () => {
  globalThis.fetch = async () =>
    json({ error: "Local storage is unavailable. Retry." }, 503);
  await assert.rejects(() => loadWorkspace(), /Local storage is unavailable/);
  globalThis.fetch = async () => json({ error: "" }, 503);
  await assert.rejects(() => loadWorkspace(), /HTTP 503/);
});
test("unreadable and schema-mismatched responses become explicit startup errors", async () => {
  globalThis.fetch = async () => new Response("<html>Error</html>");
  await assert.rejects(() => loadWorkspace(), /unreadable response/);
  globalThis.fetch = async () => json({ books: [] });
  await assert.rejects(() => loadWorkspace(), /invalid data/);
});
test("network failure is recoverable by making a fresh request", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(
    () => loadWorkspace(),
    /Could not reach the local workspace/,
  );
  globalThis.fetch = async () => json(workspace);
  assert.deepEqual(await loadWorkspace(), workspace);
});
test("a pending workspace request is aborted at its deadline", async () => {
  let aborted = false;
  globalThis.fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init!.signal!.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(init!.signal!.reason);
        },
        { once: true },
      );
    });
  await assert.rejects(() => loadWorkspace({ timeoutMs: 20 }), /timed out/);
  assert.equal(aborted, true);
});
test("the deadline also covers a stalled response body", async () => {
  globalThis.fetch = async (_url, init) => {
    const body = new ReadableStream({
      start(controller) {
        init!.signal!.addEventListener(
          "abort",
          () => controller.error(init!.signal!.reason),
          { once: true },
        );
      },
    });
    return new Response(body);
  };
  await assert.rejects(() => loadWorkspace({ timeoutMs: 20 }), /timed out/);
});
test("leaving the page cancels the request without disguising it as a server failure", async () => {
  const controller = new AbortController();
  globalThis.fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init!.signal!.addEventListener(
        "abort",
        () => reject(init!.signal!.reason),
        { once: true },
      );
    });
  const request = loadWorkspace({ signal: controller.signal });
  controller.abort();
  await assert.rejects(request, (error: Error) => error.name === "AbortError");
});
