import { expect, test } from "@playwright/test";

test("home page loads @cross-browser @mobile", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBe(true);
});
