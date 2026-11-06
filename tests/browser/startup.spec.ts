import { test, expect } from "@playwright/test";

test("loopback hostname hydrates over HMR and starts exactly one active workspace load", async ({
  page,
}) => {
  const errors: string[] = [],
    sockets: string[] = [];
  let frames = 0,
    requests = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) => {
    sockets.push(socket.url());
    socket.on("socketerror", (error) => errors.push(error));
    socket.on("framereceived", () => {
      frames++;
    });
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/workspace") requests++;
  });
  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/workspace" &&
      response.status() === 200,
  );
  await page.goto("/");
  const data = await (await responsePromise).json();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  expect(data.connection.connected).toBe(false);
  expect(data.connection.configured).toBe(false);
  expect(
    sockets.some((url) => url.startsWith("ws://127.0.0.1:3101/_next/hmr")),
  ).toBe(true);
  expect(frames).toBeGreaterThan(0);
  // Strict Mode can start then cancel its probe; there must be no reload loop.
  expect(requests).toBeGreaterThan(0);
  expect(requests).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});

for (const failure of ["http", "network", "json", "schema"] as const) {
  test(`startup ${failure} failure shows a recoverable error and retry loads data`, async ({
    page,
  }) => {
    let fail = true;
    await page.route("**/api/workspace", (route) => {
      if (!fail) return route.continue();
      if (failure === "network") return route.abort("connectionrefused");
      if (failure === "http")
        return route.fulfill({
          status: 503,
          json: { error: "Local storage is unavailable. Retry." },
        });
      if (failure === "json")
        return route.fulfill({
          contentType: "text/html",
          body: "<h1>Service unavailable</h1>",
        });
      return route.fulfill({ json: { books: [] } });
    });
    await page.goto("/");
    const alert = page
      .getByRole("alert")
      .filter({ hasText: "Workspace could not be loaded" });
    await expect(alert).toBeVisible();
    const message = {
      http: "Local storage is unavailable",
      network: "Could not reach",
      json: "unreadable response",
      schema: "invalid data",
    }[failure];
    await expect(alert).toContainText(message);
    await expect(
      page.getByText("Opening your workspace…", { exact: true }),
    ).toBeHidden();
    fail = false;
    await alert
      .getByRole("button", { name: "Retry loading workspace" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Dashboard", exact: true }),
    ).toBeVisible();
    await expect(alert).toBeHidden();
  });
}

test("a stalled startup fetch has a finite deadline and can be retried", async ({
  page,
}) => {
  await page.clock.install();
  let release!: () => void,
    requests = 0;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const handler = async (route: import("@playwright/test").Route) => {
    requests++;
    await pending;
    await route.abort().catch(() => {});
  };
  await page.route("**/api/workspace", handler);
  await page.goto("/");
  await expect.poll(() => requests).toBeGreaterThan(0);
  await page.clock.fastForward(16_000);
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "Workspace could not be loaded" });
  await expect(alert).toContainText("timed out after 15 seconds");
  release();
  await page.unroute("**/api/workspace", handler);
  await alert.getByRole("button", { name: "Retry loading workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
});

test("empty library renders and all six sections navigate without Canva", async ({
  page,
}) => {
  await page.route("**/api/workspace", async (route) => {
    // Run the real API/migrations first, then exercise a valid empty-library response.
    const response = await route.fetch(),
      data = await response.json();
    expect(response.status()).toBe(200);
    expect(data.connection.connected).toBe(false);
    await route.fulfill({
      json: { ...data, books: [], assets: [], templates: [], jobs: [] },
    });
  });
  await page.goto("/");
  for (const [name, path] of [
    ["Book Library", "/books"],
    ["Asset Library", "/assets"],
    ["Templates", "/templates"],
    ["Publishing", "/publishing"],
    ["Settings", "/settings"],
    ["Dashboard", "/"],
  ]) {
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Canva not connected" }),
    ).toBeVisible();
  }
});
