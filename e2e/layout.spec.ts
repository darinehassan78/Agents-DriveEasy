// Q11: no horizontal scroll on key public pages, desktop and phone widths.
import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll } from "./helpers";

const PUBLIC_PAGES = ["/", "/search", "/branches", "/login", "/register"];

for (const path of PUBLIC_PAGES) {
  test(`no horizontal scroll on ${path} @mobile @cross-browser`, async ({ page }) => {
    const res = await page.goto(path);
    test.skip(res?.status() === 404, `${path} not built yet`);
    expect(res?.status(), `${path} status`).toBeLessThan(500);
    await expectNoHorizontalScroll(page);
  });
}

test("navigation is reachable at phone width @mobile", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation").first();
  await expect(nav).toBeVisible();
  // Either links are visible directly or behind a menu button.
  const menu = page.getByRole("button", { name: /menu/i });
  if (await menu.isVisible().catch(() => false)) await menu.click();
  await expect(page.getByRole("link", { name: /log ?in|sign ?in/i }).first()).toBeVisible();
});
