// Q2: registration, login, logout and page-level authorisation in the browser.
import { expect, test } from "@playwright/test";
import { SEED, login, logout, newEmail, register } from "./helpers";

test.describe("auth", () => {
  test("register -> logout -> login again @cross-browser @mobile", async ({ page }) => {
    const { email, password } = await register(page, { email: newEmail("reg") });
    await logout(page);
    await page.goto("/rentals");
    await expect(page).toHaveURL(/\/login/);
    await login(page, email, password);
    await page.goto("/rentals");
    await expect(page).toHaveURL(/\/rentals/);
  });

  test("wrong password shows an error and stays on login", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(SEED.customer.email);
    await page.getByLabel("Password", { exact: true }).fill("not-the-password");
    await page.getByTestId("login-submit").click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("registration validates mismatched passwords and duplicate email", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Full name").fill("QA");
    await page.getByLabel("Email").fill(newEmail("mm"));
    await page.getByLabel("Password", { exact: true }).fill("Passw0rd-QA");
    await page.getByLabel("Confirm password").fill("Different-1");
    await page.getByTestId("register-submit").click();
    await expect(page).toHaveURL(/\/register/);

    await page.goto("/register");
    await page.getByLabel("Full name").fill("QA");
    await page.getByLabel("Email").fill(SEED.customer.email);
    await page.getByLabel("Password", { exact: true }).fill("Passw0rd-QA");
    await page.getByLabel("Confirm password").fill("Passw0rd-QA");
    await page.getByTestId("register-submit").click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page).toHaveURL(/\/register/);
  });

  for (const path of ["/rentals", "/profile", "/admin", "/admin/fleet"]) {
    test(`anonymous visitor is sent to login from ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    });
  }

  test("login redirect target cannot be an external site", async ({ page }) => {
    await page.goto("/login?next=https://evil.example.com/&callbackUrl=//evil.example.com");
    await page.getByLabel("Email").fill(SEED.customer.email);
    await page.getByLabel("Password", { exact: true }).fill(SEED.customer.password);
    await page.getByTestId("login-submit").click();
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(new URL(page.url()).hostname).toBe("localhost");
  });
});

test.describe("admin authorisation", () => {
  const ADMIN_PAGES = ["/admin", "/admin/branches", "/admin/fleet", "/admin/pricing", "/admin/reservations", "/admin/damage"];

  test("a customer cannot open any admin page", async ({ page }) => {
    await login(page, SEED.customer.email, SEED.customer.password);
    for (const path of ADMIN_PAGES) {
      const res = await page.goto(path);
      const onAdmin = new URL(page.url()).pathname.startsWith("/admin");
      // Either redirected away, or a 403/404 page. Never admin content.
      if (onAdmin) expect([403, 404], `${path} returned ${res?.status()}`).toContain(res?.status());
      await expect(page.getByTestId("admin-shell")).toHaveCount(0);
    }
  });

  test("an admin can open every admin page", async ({ page }) => {
    await login(page, SEED.admin.email, SEED.admin.password);
    for (const path of ADMIN_PAGES) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expect(page).toHaveURL(new RegExp(path.replace(/\//g, "\\/")));
    }
  });
});
