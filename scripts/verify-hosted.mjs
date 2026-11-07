// Non-destructive hosted verification: real owner auth, D1/R2 and Chrome.
// Never starts a Canva publishing job or changes an imported book.
import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";
const environment = process.argv.includes("--production")
  ? "production"
  : "staging";
const origin =
  environment === "production"
    ? "https://storybookbuilder.allencreativetechnologies.uk"
    : "https://story-book-builder-staging.garetha81.workers.dev";
const access = JSON.parse(
  fs.readFileSync(`.local/${environment}-owner-access.json`, "utf8"),
);
assert.equal(access.url, origin);
const receiptPath = `.local/${environment}-hosted-storage.json`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: ["--disable-extensions"],
});
try {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();
  const exceptions = [],
    failures = [];
  page.on("pageerror", (error) => exceptions.push(error.message));
  page.on("requestfailed", (request) =>
    failures.push(new URL(request.url()).pathname),
  );
  assert.equal(
    (await context.request.get(`${origin}/api/workspace`)).status(),
    401,
  );
  assert.equal(
    (await context.request.get(`${origin}/api/assets/private`)).status(),
    401,
  );
  await page.goto(`${origin}/login`);
  await page.getByLabel("Password", { exact: true }).fill(access.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const api = async (route, method = "GET", data) => {
    const response = await context.request.fetch(origin + route, {
      method,
      headers: { Origin: origin },
      ...(data === undefined ? {} : { data }),
    });
    assert.ok(
      response.ok(),
      `${method} ${route}: HTTP ${response.status()} ${await response.text()}`,
    );
    return response.json();
  };
  const initial = await api("/api/workspace");
  assert.ok(initial.books.length >= 2);
  assert.ok(initial.assets.length >= 44);
  for (const [route, heading] of [
    ["/books", "Book Library"],
    ["/assets", "Asset Library"],
    ["/templates", "Templates"],
    ["/publishing", "Publishing"],
    ["/settings", "Settings"],
    ["/", "Workspace"],
  ]) {
    await page.goto(origin + route);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `Horizontal overflow: ${route}`,
    );
  }
  assert.equal(
    (
      await context.request.put(`${origin}/api/settings`, {
        headers: { Origin: "https://attacker.example" },
        data: initial.preferences,
      })
    ).status(),
    403,
  );
  const imported = JSON.parse(
    fs.readFileSync(".local/staging-artwork-manifest.json", "utf8"),
  );
  for (const asset of initial.assets.filter((asset) =>
    imported.some((entry) => entry.name === asset.filename),
  )) {
    const expected = imported.find((entry) => entry.name === asset.filename);
    const received = await page.evaluate(async (id) => {
      const response = await fetch(`/api/assets/${id}`, {
        signal: AbortSignal.timeout(60000),
      });
      const bytes = await response.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return {
        status: response.status,
        mime: response.headers.get("content-type"),
        length: response.headers.get("content-length"),
        bytes: bytes.byteLength,
        sha256: [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join(""),
      };
    }, asset.id);
    assert.equal(received.status, 200);
    assert.equal(received.mime, asset.mime);
    assert.equal(received.bytes, expected.bytes, asset.filename);
    assert.equal(received.sha256, expected.sha256, asset.filename);
    console.log(`Chrome verified ${asset.filename}`);
  }
  let receipt;
  if (process.argv.includes("--resume")) {
    receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  } else {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEo8AAAAASUVORK5CYII=",
      "base64",
    );
    const upload = async (name) => {
      const response = await context.request.post(`${origin}/api/assets`, {
        headers: { Origin: origin },
        multipart: { file: { name, mimeType: "image/png", buffer: png } },
      });
      assert.equal(response.status(), 201, await response.text());
      return response.json();
    };
    const disposable = await upload("Hosted deletion verification.png");
    await api(`/api/assets/${disposable.id}`, "DELETE");
    assert.equal(
      (
        await context.request.get(`${origin}/api/assets/${disposable.id}`)
      ).status(),
      404,
    );
    const asset = await upload("Hosted persistence verification.png");
    let book = await api("/api/books", "POST", {
      title: `Hosted storage verification ${new Date().toISOString()}`,
      author: "Verification fixture",
      pageCount: 33,
    });
    book.pages[0].text = "D1 and private R2 persistence verification.";
    book.pages[0].assetId = asset.id;
    book = await api(`/api/books/${book.id}`, "PUT", book);
    await page.reload();
    await page
      .getByRole("combobox", { name: "Book project", exact: true })
      .selectOption(book.id);
    const manuscript = page.getByRole("textbox", {
      name: "Manuscript text",
      exact: true,
    });
    await expect(manuscript).toHaveValue(book.pages[0].text);
    await manuscript.fill("Hosted Chrome autosave persisted on D1.");
    await expect(
      page.getByRole("status").filter({ hasText: "All changes saved" }),
    ).toBeVisible();
    await page.reload();
    await expect(manuscript).toHaveValue(
      "Hosted Chrome autosave persisted on D1.",
    );
    await page.setViewportSize({ width: 2560, height: 1440 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: `.local/${environment}-workspace-2560.png`,
      fullPage: true,
    });
    book = await api(`/api/books/${book.id}`);
    book.status = "archived";
    book = await api(`/api/books/${book.id}`, "PUT", book);
    receipt = {
      origin,
      bookId: book.id,
      assetId: asset.id,
      filename: asset.filename,
      mime: asset.mime,
      sha256: sha256(png),
      text: book.pages[0].text,
      verifiedAt: new Date().toISOString(),
    };
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  }
  assert.equal(receipt.origin, origin);
  const saved = await api(`/api/books/${receipt.bookId}`);
  assert.equal(saved.pages[0].text, receipt.text);
  assert.equal(saved.pages[0].assetId, receipt.assetId);
  const persistedImage = await context.request.get(
    `${origin}/api/assets/${receipt.assetId}`,
  );
  assert.equal(persistedImage.status(), 200);
  assert.equal(sha256(await persistedImage.body()), receipt.sha256);
  const connect = await api("/api/canva/connect", "POST");
  const authorization = new URL(connect.url);
  assert.equal(
    authorization.searchParams.get("redirect_uri"),
    `${origin}/auth/canva/callback`,
  );
  const declined = await context.request.get(
    `${origin}/auth/canva/callback?state=${encodeURIComponent(authorization.searchParams.get("state"))}&error=access_denied`,
    { maxRedirects: 0 },
  );
  assert.equal(declined.status(), 303);
  assert.ok(declined.headers().location.includes("declined"));
  assert.deepEqual(exceptions, [], "Hosted browser exceptions");
  // Navigation can cancel in-flight prefetches; record them separately.
  fs.writeFileSync(
    `.local/${environment}-hosted-browser.json`,
    JSON.stringify(
      {
        origin,
        verifiedAt: new Date().toISOString(),
        resumed: process.argv.includes("--resume"),
        checks: {
          https: true,
          ownerAuth: true,
          workspace: true,
          batchR2: true,
          d1Persistence: true,
          oauthRedirectAndDenial: true,
        },
        browserExceptions: exceptions,
        cancelledRequests: failures,
        fixture: receipt,
      },
      null,
      2,
    ),
  );
  console.log(
    `${environment}: live HTTPS, owner sign-in, six desktop routes, imported artwork hashes/MIME, private upload/read/delete, D1 autosave/reload, persisted fixture and OAuth redirect/denial passed. Live Canva authorization remains separate.`,
  );
} finally {
  await browser.close();
}
