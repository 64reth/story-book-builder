import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  artworkAssignments,
  numberedManuscript,
} from "../src/lib/batch-import";
import { storage } from "../src/lib/storage";
process.env.STORYBOOK_DATA_DIR = mkdtempSync(
  path.join(os.tmpdir(), "storybook-atomic-"),
);
test("numbered artwork and natural sorting produce editable unique assignments", () => {
  const plan = artworkAssignments(
    [
      "page_10.png",
      "page_2.png",
      "cover.png",
      "page_3.png",
      "page_3-copy.png",
      "outside_90.png",
    ],
    33,
  );
  assert.equal(plan.find((p) => p.name === "page_10.png")!.page, 9);
  assert.equal(plan.find((p) => p.name === "page_2.png")!.page, 1);
  assert.equal(plan.find((p) => p.name === "outside_90.png")!.page, null);
  assert.equal(
    new Set(plan.filter((p) => p.page !== null).map((p) => p.page)).size,
    plan.filter((p) => p.page !== null).length,
  );
  assert.deepEqual(
    artworkAssignments(["b.png", "a.png"], 2).map((p) => p.name),
    ["a.png", "b.png"],
  );
});
test("explicit manuscript numbering preserves unspecified pages and rejects ambiguity", () => {
  assert.deepEqual(
    numberedManuscript("# Page 3\nThird page\n\nPage 1:\nOpening", 3, [
      "old",
      "keep",
      "old",
    ]),
    ["Opening", "keep", "Third page"],
  );
  assert.equal(
    numberedManuscript("Unnumbered paragraphs", 3, ["a", "b", "c"]),
    null,
  );
  assert.throws(
    () => numberedManuscript("Page 1\na\nPage 1\nb", 3, ["a", "b", "c"]),
    /unique/,
  );
});
test("portable transactions roll back stale batches instead of partially overwriting records", async () => {
  const db = storage();
  await db.run("INSERT INTO settings VALUES ('shared','original')");
  let release!: () => void, entered!: () => void;
  const wait = new Promise<void>((r) => (release = r)),
    ready = new Promise<void>((r) => (entered = r));
  const stale = db.transaction(async () => {
    await db.get("SELECT document FROM settings WHERE id='shared'");
    entered();
    await wait;
    await db.run("UPDATE settings SET document='stale' WHERE id='shared'");
    await db.run("INSERT INTO settings VALUES ('partial','must not exist')");
  });
  await ready;
  await db.run("UPDATE settings SET document='fresh' WHERE id='shared'");
  release();
  await assert.rejects(() => stale, /changed concurrently/);
  assert.equal(
    (await db.get<{ document: string }>(
      "SELECT document FROM settings WHERE id='shared'",
    ))!.document,
    "fresh",
  );
  assert.equal(
    await db.get("SELECT document FROM settings WHERE id='partial'"),
    undefined,
  );
});
