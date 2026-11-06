import { test, expect } from "@playwright/test";
import sharp from "sharp";
const origin = "http://127.0.0.1:3101";

test("create, autosave, import, reorder, version and validate a book", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/dashboard-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Create New Book", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Book title").fill("The Moonlit Bakery");
  await dialog.getByLabel("Author").fill("A. Writer");
  await dialog.getByLabel("Page count").selectOption("24");
  await dialog
    .getByRole("button", { name: "Create book", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "The Moonlit Bakery",
      level: 1,
      exact: true,
    }),
  ).toBeVisible();
  const bookURL = page.url();
  const preview = page.locator(".canvas-stage > .page-preview:visible");
  const dimensions = await preview.boundingBox();
  expect(dimensions!.width / dimensions!.height).toBeCloseTo(8.625 / 8.7, 2);
  await page
    .getByRole("textbox", { name: "Manuscript text", exact: true })
    .fill("The bakery opened beneath a silver moon.");
  await expect(
    page.getByRole("status").filter({ hasText: "All changes saved" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Manuscript text", exact: true }),
  ).toHaveValue("The bakery opened beneath a silver moon.");
  await page
    .getByRole("button", { name: "Import manuscript", exact: true })
    .click();
  await dialog
    .getByLabel("Manuscript", { exact: true })
    .fill("First page.\n---\nSecond page.");
  await dialog.getByRole("button", { name: "Review 24 pages" }).click();
  await expect(dialog.getByRole("textbox", { name: /^Page 1 ·/ })).toHaveValue(
    "First page.",
  );
  await dialog.getByRole("button", { name: "Apply manuscript" }).click();
  await expect(
    page.getByRole("textbox", { name: "Manuscript text", exact: true }),
  ).toHaveValue("First page.");
  await page.getByRole("button", { name: "Move later", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Manuscript text", exact: true }),
  ).toHaveValue("First page.");
  await page
    .getByRole("button", { name: "Select page 1", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Manuscript text", exact: true }),
  ).toHaveValue("Second page.");
  await expect(
    page.getByRole("status").filter({ hasText: "All changes saved" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Draft versions", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Save current version", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Restore", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.screenshot({ path: ".local/editor-desktop.png", fullPage: true });
  await page.getByRole("link", { name: "Validate book", exact: true }).click();
  await page
    .getByRole("button", { name: "Validate readiness", exact: true })
    .click();
  await expect(
    page
      .locator(".issue.error:visible")
      .filter({ hasText: "Connect Canva in Settings." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate Canva Draft", exact: true }),
  ).toBeDisabled();
  await page.goto(bookURL);
  await expect(
    page.getByRole("textbox", { name: "Manuscript text", exact: true }),
  ).toHaveValue("Second page.");
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileDimensions = await preview.boundingBox();
  expect(mobileDimensions!.width / mobileDimensions!.height).toBeCloseTo(
    8.625 / 8.7,
    2,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".local/editor-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("upload, rename, assign, replace and protect an illustration", async ({
  page,
}) => {
  await page.goto("/assets");
  await expect(
    page.getByRole("heading", { name: "Asset Library", exact: true }),
  ).toBeVisible();
  const bytes = await sharp({
    create: { width: 2700, height: 2700, channels: 3, background: "#bfcfa8" },
  })
    .png()
    .toBuffer();
  await page.getByLabel("Upload illustrations", { exact: true }).setInputFiles({
    name: "Moonlit artwork.png",
    mimeType: "image/png",
    buffer: bytes,
  });
  await page.getByRole("button", { name: /Moonlit artwork/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Illustration name").fill("Bakery illustration");
  await dialog.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Bakery illustration/ }),
  ).toBeVisible();
  await dialog
    .getByRole("combobox", { name: "Book", exact: true })
    .selectOption({ label: "The Moonlit Bakery" });
  await dialog
    .getByRole("combobox", { name: "Page", exact: true })
    .selectOption("0");
  await dialog
    .getByRole("button", { name: "Assign illustration", exact: true })
    .click();
  await expect(
    page.getByText("Assigned to page 1", { exact: true }),
  ).toBeVisible();
  await dialog.getByLabel("Replacement image").setInputFiles({
    name: "Revised.png",
    mimeType: "image/png",
    buffer: bytes,
  });
  await expect(
    page.getByText("1 illustration replaced.", { exact: true }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "referenced" }),
  ).toContainText("referenced");
});

test("API boundaries reject cross-origin writes, invalid input and missing sessions", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  const hostile = await page.request.post("/api/books", {
    headers: { origin: "https://evil.example" },
    data: { title: "attack", pageCount: 24 },
  });
  expect(hostile.status()).toBe(403);
  const invalid = await page.request.post("/api/books", {
    headers: { origin },
    data: { title: "", pageCount: 5 },
  });
  expect(invalid.status()).toBe(400);
  const anonymous = await request.post("/api/books", {
    headers: { origin },
    data: { title: "no session", pageCount: 24 },
  });
  expect(anonymous.status()).toBe(401);
  const oauth = await page.request.get(
    "/auth/canva/callback?state=invalid&code=invalid",
    { maxRedirects: 0 },
  );
  expect(oauth.status()).toBe(303);
  expect(oauth.headers().location).toContain("state");
});

test("responsive routes, unverified template, settings and persisted dark theme", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [route, heading] of [
    ["/", "Dashboard"],
    ["/books", "Book Library"],
    ["/assets", "Asset Library"],
    ["/templates", "Templates"],
    ["/publishing", "Publishing"],
    ["/settings", "Settings"],
  ]) {
    await page.goto(route);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await expect(
    page.getByText(/Missing configuration: CANVA_CLIENT_SECRET/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect Canva", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("combobox", { name: "Theme", exact: true })
    .selectOption("dark");
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: ".local/settings-mobile-dark.png",
    fullPage: true,
  });
  await page
    .getByRole("combobox", { name: "Theme", exact: true })
    .selectOption("light");
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Toggle navigation", exact: true })
    .click();
  await page.getByRole("link", { name: "Templates", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Templates", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Dataset has not been retrieved",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Inspect live dataset", exact: true }),
  ).toBeDisabled();
  await page.goto("/");
  await page.screenshot({
    path: ".local/dashboard-mobile.png",
    fullPage: true,
  });
});
