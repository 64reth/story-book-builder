import { defineConfig } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
mkdirSync(".local", { recursive: true });
const testData = mkdtempSync(path.join(process.cwd(), ".local", "browser-"));
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
export default defineConfig({
  testDir: "tests/browser",
  timeout: 45000,
  expect: { timeout: 12000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3101",
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      ...(existsSync(chrome) ? { executablePath: chrome } : {}),
      args: ["--disable-extensions"],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    // Match the original failure: Next defaults to localhost, browser uses 127.0.0.1.
    command: "node node_modules/next/dist/bin/next dev --port 3101",
    url: "http://127.0.0.1:3101",
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      STORYBOOK_DATA_DIR: testData,
      STORYBOOK_NEXT_DIR: ".next-browser",
      APP_URL: "http://127.0.0.1:3101",
      CANVA_REDIRECT_URI: "http://127.0.0.1:3101/auth/canva/callback",
      CANVA_CLIENT_SECRET: "",
      SESSION_SECRET:
        "isolated-browser-test-session-secret-at-least-32-characters",
    },
  },
});
