import { type Browser, type Page, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Seed accounts (src/server/db/seed.ts SEED_PASSWORDS; test data only).
export const SEED = {
  admin: { email: "admin@driveeasy.test", password: "DriveEasy-Admin-1" },
  customer: { email: "customer@driveeasy.test", password: "DriveEasy-Customer-1" },
  customer2: { email: "customer2@driveeasy.test", password: "DriveEasy-Customer-2" },
};

export const PASSWORD = "Qa-Passw0rd!2026";

export function newEmail(tag = "user") {
  return `qa-${tag}-${randomUUID().slice(0, 8)}@driveeasy.test`;
}

export async function expectNoHorizontalScroll(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `page is ${scrollWidth}px wide in a ${clientWidth}px viewport`).toBeLessThanOrEqual(
    clientWidth + 1,
  );
}

export async function register(page: Page, opts: { email?: string; name?: string; password?: string } = {}) {
  const email = opts.email ?? newEmail();
  const password = opts.password ?? PASSWORD;
  await page.goto("/register");
  await page.getByLabel("Full name").fill(opts.name ?? "QA Customer");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByTestId("register-submit").click();
  await expect(page).not.toHaveURL(/\/register/);
  return { email, password };
}

export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function logout(page: Page) {
  const menu = page.getByRole("button", { name: /menu|account/i });
  if (await menu.isVisible().catch(() => false)) await menu.click();
  await page.getByRole("button", { name: /log ?out|sign ?out/i }).first().click();
}

/** A fresh browser context with a newly registered customer. */
export async function newCustomer(browser: Browser, tag = "user") {
  const context = await browser.newContext();
  const page = await context.newPage();
  const creds = await register(page, { email: newEmail(tag) });
  return { context, page, ...creds };
}

/** Wall-clock "YYYY-MM-DDTHH:mm" N days ahead (branch local time). */
export function localDateTime(daysAhead: number, hour = 10, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:${pad(minute)}`;
}
