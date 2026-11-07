import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { partialFixture } from "../fixtures/partial-book";

for (const size of [
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
]) {
  test(`desktop workspace at ${size.width} supports reviewed batch artwork and numbered Markdown`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Workspace", exact: true }),
    ).toBeVisible();
    const response = await page.request.post("/api/books", {
      headers: { Origin: "http://127.0.0.1:3101" },
      data: { title: `Desktop ${size.width}`, author: "", pageCount: 33 },
    });
    expect(response.status()).toBe(201);
    const book = await response.json();
    await page.reload();
    await page
      .getByRole("combobox", { name: "Book project", exact: true })
      .selectOption(book.id);
    const png = await sharp({
      create: { width: 120, height: 120, channels: 3, background: "#aac7a1" },
    })
      .png()
      .toBuffer();
    await page.getByLabel("Batch artwork files").setInputFiles([
      { name: "page_02.png", mimeType: "image/png", buffer: png },
      { name: "page_01.png", mimeType: "image/png", buffer: png },
    ]);
    const rows = page.locator(".assignment-rows label");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).getByRole("combobox")).toHaveValue("0");
    await expect(rows.nth(1).getByRole("combobox")).toHaveValue("1");
    await page
      .getByRole("button", { name: "Apply reviewed artwork", exact: true })
      .click();
    await expect(rows).toHaveCount(0);
    await page
      .getByRole("button", { name: "Import manuscript", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .locator('input[type="file"]')
      .setInputFiles({
        name: "story.md",
        mimeType: "text/markdown",
        buffer: Buffer.from(
          "# Page 3\nThe third page.\n\n## Page 1\nThe beginning.",
        ),
      });
    await dialog.getByRole("button", { name: "Review 33 pages" }).click();
    await expect(dialog.getByRole("textbox", { name: /^Page 3 / })).toHaveValue(
      "The third page.",
    );
    await dialog
      .getByRole("button", { name: "Apply manuscript", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "All changes saved" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Manuscript text", exact: true }),
    ).toHaveValue("The beginning.");
    const persisted = await (
      await page.request.get(`/api/books/${book.id}`)
    ).json();
    expect(persisted.pages[0].assetId).toBeTruthy();
    expect(persisted.pages[1].assetId).toBeTruthy();
    expect(persisted.pages[2].text).toBe("The third page.");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/build002-workspace-${size.width}.png`,
      fullPage: true,
    });
  });
}

test("refinement requires explicit target selection and affected-field review", async ({
  page,
}) => {
  const { book, workspace } = partialFixture();
  let selected = false,
    submissions = 0;
  await page.route("**/api/workspace", (route) =>
    route.fulfill({ json: workspace }),
  );
  await page.route(`**/api/books/${book.id}/drafts`, (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON().designId).toBe("generated-target");
      selected = true;
      return route.fulfill({ json: { designId: "generated-target" } });
    }
    return route.fulfill({
      json: {
        active: selected ? "generated-target" : undefined,
        candidates: [
          {
            designId: "generated-target",
            publishedAt: new Date().toISOString(),
          },
        ],
      },
    });
  });
  await page.route(`**/api/books/${book.id}/refinement-plan`, (route) =>
    route.fulfill({
      json: {
        designId: "generated-target",
        revision: book.revision,
        fields: [
          { page: 1, field: "PAGE_01_TEXT", kind: "text", text: "Revised" },
        ],
        skipped: [],
        warning:
          "These tagged fields may overwrite manual Canva edits. Untouched fields are omitted.",
      },
    }),
  );
  await page.route(`**/api/books/${book.id}/publish`, (route) => {
    submissions++;
    expect(route.request().postDataJSON()).toEqual({
      operation: "update_design",
      approved: {
        fields: ["PAGE_01_TEXT"],
        revision: book.revision,
        designId: "generated-target",
      },
    });
    return route.fulfill({ json: { message: "Generating", status: "queued" } });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Refine Canva Draft", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Active Canva draft", exact: true })
    .selectOption("generated-target");
  await page
    .getByRole("button", { name: "Refine Canva Draft", exact: true })
    .click();
  const review = page.getByRole("region", { name: "Refinement review" });
  await expect(review).toContainText("PAGE_01_TEXT");
  await expect(review).toContainText("overwrite manual Canva edits");
  expect(submissions).toBe(0);
  await review
    .getByRole("button", { name: "Refine 1 reviewed fields" })
    .click();
  await expect.poll(() => submissions).toBe(1);
});
