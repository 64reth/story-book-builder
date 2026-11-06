import { test, expect } from "@playwright/test";
import { partialFixture } from "../fixtures/partial-book";
import type { JobSummary } from "../../src/lib/types";

test("history exposes created design and job IDs; status/link refresh never starts another publish", async ({
  page,
}) => {
  const { book, workspace } = partialFixture();
  const stamp = new Date().toISOString();
  const job: JobSummary = {
    id: "local-job",
    bookId: book.id,
    title: book.title,
    status: "success",
    message: "Editable Canva draft created",
    progress: 100,
    createdAt: stamp,
    updatedAt: stamp,
    nextAt: 0,
    attempts: 0,
    remoteId: "remote-job",
    designId: "generated-design",
    designUrl: "https://www.canva.com/design/generated-design/edit",
  };
  workspace.jobs = [job];
  await page.route("**/api/workspace", (route) =>
    route.fulfill({ json: workspace }),
  );
  let publishes = 0,
    checks = 0,
    unavailable = false;
  await page.route("**/api/books/*/publish", (route) => {
    publishes++;
    return route.abort();
  });
  await page.route("**/api/jobs/local-job/recheck", (route) => {
    checks++;
    if (unavailable)
      return route.fulfill({
        status: 502,
        json: {
          error: "Canva returned 404 (not_found). Check account access.",
        },
      });
    job.resultType = "create_design";
    job.confirmedAt = stamp;
    job.designUrl =
      "https://www.canva.com/design/generated-design/edit?refreshed=1";
    return route.fulfill({ json: job });
  });
  await page.goto("/publishing");
  const history = page.getByRole("table");
  await expect(history).toContainText("Complete");
  await expect(history).toContainText("CREATED a separate design");
  await expect(history).toContainText("remote-job");
  await expect(history).toContainText("generated-design");
  await expect(
    page.getByText("Local saves do not change Canva.", { exact: false }),
  ).toBeVisible();
  await history
    .getByRole("button", { name: "Check Canva status / refresh link" })
    .click();
  await expect(history).toContainText("create_design");
  await expect(
    history.getByRole("link", { name: "Open in Canva" }),
  ).toHaveAttribute("href", /refreshed=1/);
  unavailable = true;
  await history
    .getByRole("button", { name: "Check Canva status / refresh link" })
    .click();
  await expect(history.getByRole("alert")).toContainText("404");
  await expect(history).toContainText(
    "Previous publishing records are preserved",
  );
  await expect(history).toContainText("Complete");
  expect(checks).toBe(2);
  expect(publishes).toBe(0);
});

test("a pending job is Generating and has no completion link", async ({
  page,
}) => {
  const { book, workspace } = partialFixture();
  const stamp = new Date().toISOString();
  workspace.jobs = [
    {
      id: "pending",
      bookId: book.id,
      title: book.title,
      status: "generating",
      message: "Awaiting Canva",
      progress: 75,
      createdAt: stamp,
      updatedAt: stamp,
      nextAt: Date.now() + 600000,
      attempts: 0,
      remoteId: "remote-pending",
    },
  ];
  await page.route("**/api/workspace", (route) =>
    route.fulfill({ json: workspace }),
  );
  await page.goto("/publishing");
  await expect(page.getByRole("table")).toContainText("Generating");
  await expect(page.getByRole("table")).not.toContainText("Complete");
  await expect(page.getByRole("link", { name: "Open in Canva" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Create New Canva Draft", exact: true }),
  ).toBeDisabled();
});
