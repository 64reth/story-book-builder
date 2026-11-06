import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { partialFixture } from "../fixtures/partial-book";
import { validateBook } from "../../src/lib/validation";
import type { JobSummary } from "../../src/lib/types";

test("partial draft remains enabled with compact advisories and explicit skipped-content reports", async ({
  page,
}) => {
  const { book, template, assets, workspace } = partialFixture();
  const validation = validateBook(book, template, assets, true, 300);
  await page.route("**/api/workspace", (route) =>
    route.fulfill({ json: workspace }),
  );
  await page.route(`**/api/books/${book.id}/validate`, (route) =>
    route.fulfill({ json: validation }),
  );
  let generations = 0;
  await page.route(`**/api/books/${book.id}/publish`, (route) => {
    generations++;
    const stamp = new Date().toISOString();
    const job: JobSummary = {
      id: randomUUID(),
      bookId: book.id,
      title: book.title,
      status: "queued",
      message: "Ready to upload compatible illustrations",
      progress: 0,
      createdAt: stamp,
      updatedAt: stamp,
      nextAt: Date.now() + 600000,
      attempts: 0,
      validation,
    };
    workspace.jobs = [job];
    return route.fulfill({ status: 201, json: job });
  });
  await page.goto("/publishing");
  const readiness = page.getByRole("region", { name: "Draft readiness" });
  const generate = page.getByRole("button", {
    name: "Generate Canva Draft",
    exact: true,
  });
  await expect(generate).toBeEnabled();
  await expect(readiness).toContainText(
    "26 text fields and 33 image fields will be submitted",
  );
  await expect(readiness.locator(".issue.warning")).toHaveCount(4);
  await expect(
    readiness.locator(".issue.warning").filter({
      hasText:
        "33 illustrations are below the 300 DPI print target (101–144 DPI). Review before final print export.",
    }),
  ).toBeVisible();
  await expect(
    readiness
      .locator(".issue.warning")
      .filter({ hasText: "6 pages have no manuscript text (28–33)." }),
  ).toBeVisible();
  await expect(
    readiness.locator(".issue.warning").filter({
      hasText:
        "Page 12 text could not be mapped because PAGE_12_TEXT is an image field. Correct the label in Canva to include this text automatically.",
    }),
  ).toBeVisible();
  const skipped = readiness.locator("details").filter({
    has: page.locator("summary", { hasText: "Skipped fields (7)" }),
  });
  await expect(skipped).not.toHaveAttribute("open", "");
  await skipped.locator("summary").click();
  await expect(skipped).toContainText(
    "placeholder copy or old artwork may remain",
  );
  await expect(
    skipped.getByText("Populated content skipped", { exact: true }),
  ).toBeVisible();
  for (const field of [
    "PAGE_12_TEXT",
    ...Array.from({ length: 6 }, (_, i) => `PAGE_${i + 28}_TEXT`),
  ])
    await expect(
      skipped.locator("strong").filter({ hasText: field }),
    ).toBeVisible();
  const diagnostics = readiness
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Page diagnostics" }) });
  await expect(diagnostics).not.toHaveAttribute("open", "");
  await diagnostics.locator("summary").click();
  await expect(
    diagnostics.locator(".issue").filter({ hasText: /DPI; print target/ }),
  ).toHaveCount(33);
  await diagnostics.locator("summary").click();
  await page.screenshot({
    path: ".local/build001b-partial-readiness.png",
    fullPage: true,
  });
  await generate.click();
  await expect.poll(() => generations).toBe(1);
  await expect(page.getByRole("table")).toContainText("queued");
  await expect(page.getByRole("table")).toContainText("Submission report");
  await expect(page.getByRole("table")).toContainText(
    "Populated fields skipped: 1",
  );
});

test("actual API failures have an explicit technical retry state rather than creative blockers", async ({
  page,
}) => {
  const { book, template, assets, workspace } = partialFixture();
  const validation = validateBook(book, template, assets, true, 300);
  await page.route("**/api/workspace", (route) =>
    route.fulfill({ json: workspace }),
  );
  let failed = true;
  await page.route(`**/api/books/${book.id}/validate`, (route) =>
    failed
      ? route.fulfill({
          status: 502,
          json: {
            error:
              "Canva returned 403. Check the account scopes and design access.",
          },
        })
      : route.fulfill({ json: validation }),
  );
  await page.route(`**/api/books/${book.id}/publish`, (route) =>
    route.fulfill({
      status: 502,
      json: {
        error:
          "Canva returned 400. Check the dataset types and validate again.",
      },
    }),
  );
  await page.goto("/publishing");
  await page
    .getByRole("button", { name: "Validate readiness", exact: true })
    .click();
  const readiness = page.getByRole("region", { name: "Draft readiness" });
  await expect(readiness.getByRole("alert")).toContainText(
    "Canva returned 403",
  );
  await expect(
    page.getByRole("button", { name: "Generate Canva Draft", exact: true }),
  ).toBeDisabled();
  failed = false;
  await readiness.getByRole("button", { name: "Retry validation" }).click();
  const generate = page.getByRole("button", {
    name: "Generate Canva Draft",
    exact: true,
  });
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect(readiness.getByRole("alert")).toContainText(
    "Canva returned 400",
  );
  await expect(readiness).toContainText("Needs retry");
  await expect(readiness).toContainText("33 illustrations are below");
});

test("an entirely empty draft only blocks because no valid request can be constructed", async ({
  page,
}) => {
  const { book, workspace } = partialFixture();
  book.pages = book.pages.map((p) => ({ ...p, text: "", assetId: null }));
  await page.route("**/api/workspace", (route) =>
    route.fulfill({ json: workspace }),
  );
  await page.goto("/publishing");
  const readiness = page.getByRole("region", { name: "Draft readiness" });
  await expect(readiness).toContainText(
    "No supported, populated fields can be submitted",
  );
  await expect(readiness.locator(".issue.error")).toHaveCount(1);
  await expect(
    readiness
      .locator(".issue.warning")
      .filter({ hasText: "33 pages have no manuscript text" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate Canva Draft", exact: true }),
  ).toBeDisabled();
});
