import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

// E2E runs against a production build (`next build` + `next start`) on its own
// port, wired to driveeasy_test, so it never touches driveeasy_dev or the
// shared `next dev` on :3000. Set E2E_BASE_URL to test an already-running
// server instead (it must use driveeasy_test).
config({ path: ".env.local", quiet: true });

const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;
const testDb = process.env.TEST_DATABASE_URL;
if (!testDb || !/_test$/.test(new URL(testDb).pathname)) {
  throw new Error("TEST_DATABASE_URL (…/driveeasy_test) must be set in .env.local for e2e");
}

const serverEnv = {
  DATABASE_URL: testDb,
  APP_URL: baseURL,
  BETTER_AUTH_URL: baseURL,
  PAYMENT_PROVIDER: "fake",
  PAYMENT_WEBHOOK_URL: `${baseURL}/api/webhooks/payments`,
  STORAGE_DRIVER: "local",
  LOCAL_UPLOADS_DIR: "storage/test-uploads",
  SCHEDULER: "local",
};

// E2E_SKIP_BUILD=1 reuses the last `.next` production build.
const build = process.env.E2E_SKIP_BUILD ? "" : "pnpm build && ";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: Number(process.env.E2E_WORKERS ?? 2),
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, grep: /@cross-browser/ },
    { name: "webkit", use: { ...devices["Desktop Safari"] }, grep: /@cross-browser/ },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
    { name: "mobile-safari", use: { ...devices["iPhone 14"] }, grep: /@mobile/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm test:db:reset && ${build}pnpm start -p ${port}`,
        url: baseURL,
        env: serverEnv,
        reuseExistingServer: !process.env.CI,
        timeout: 600_000,
        stdout: "pipe",
      },
});
