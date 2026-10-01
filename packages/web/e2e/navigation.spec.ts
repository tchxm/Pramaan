import { test, expect } from "@playwright/test";

const ROUTES: Array<{ path: string; heading: RegExp }> = [
  { path: "/audit", heading: /give pramaan a frontend/i },
  { path: "/how-it-works", heading: /every verdict is/i },
  { path: "/docs", heading: /pramaan documentation/i },
  { path: "/verify", heading: /verify an evidence pack/i },
];

// Skips the boot gate (sessionStorage flag — see BootGate.tsx) so these
// two describe blocks exercise actual page content instead of the one-time
// ceremony. Scoped to just these blocks (not file-level) because the
// "browser history" block below has a test that specifically needs the
// real first-visit ceremony to fire.
test.describe("primary routes", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem("pramaan:boot-shown", "1"));
  });

  for (const route of ROUTES) {
    test(`${route.path} loads with no console errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      page.on("pageerror", (err) => errors.push(String(err)));

      await page.goto(route.path);
      await expect(page.locator("h1").first()).toContainText(route.heading);
      expect(errors).toEqual([]);
    });
  }

  test("home page loads with the shared app shell", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".shell-nav, .shell-nav--transparent")).toBeVisible();
    await expect(page.getByRole("link", { name: /pramaan/i }).first()).toBeVisible();
  });

  test("an unknown route shows a real 404, not a blank page", async ({ page }) => {
    await page.goto("/this-route-does-not-exist");
    await expect(page.getByText(/page not found/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /go home/i })).toBeVisible();
  });
});

test.describe("nav links", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem("pramaan:boot-shown", "1"));
  });

  test("every shell nav link reaches a real page, not a dead link", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Audit", exact: true }).click();
    await expect(page).toHaveURL(/\/audit$/);

    await page.getByRole("link", { name: "Method", exact: true }).click();
    await expect(page).toHaveURL(/\/how-it-works$/);

    await page.getByRole("link", { name: "Docs", exact: true }).click();
    await expect(page).toHaveURL(/\/docs$/);

    await page.getByRole("link", { name: "Evidence", exact: true }).click();
    await expect(page).toHaveURL(/\/verify$/);
  });

  test("active nav item reflects the current route", async ({ page }) => {
    await page.goto("/docs");
    await expect(page.getByRole("link", { name: "Docs", exact: true })).toHaveAttribute("aria-current", "page");
  });
});

test.describe("browser history", () => {
  test("boot gate does not replay on Back after it was already dismissed this session", async ({ page }) => {
    // Deliberately does NOT skip the gate via sessionStorage here — this
    // test needs the real first-visit ceremony to actually fire once.
    await page.goto("/");
    await page.waitForSelector(".lp-gate__skip", { timeout: 8000 });
    await page.click(".lp-gate__skip");
    await expect(page.locator(".lp-gate")).toHaveCount(0);

    await page.getByRole("link", { name: "Audit", exact: true }).click();
    await expect(page).toHaveURL(/\/audit$/);

    await page.goBack();
    await expect(page).toHaveURL("http://localhost:5173/");
    await expect(page.locator(".lp-gate")).toHaveCount(0);
  });

  test("Forward restores the page navigated away from", async ({ page }) => {
    await page.goto("/audit");
    await page.goto("/docs");
    await page.goBack();
    await expect(page).toHaveURL(/\/audit$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/docs$/);
  });

  test("a deep link to a specific route does not dump the user at Home", async ({ page }) => {
    await page.goto("/verify");
    await expect(page).toHaveURL(/\/verify$/);
    await expect(page.locator("h1")).toContainText(/verify an evidence pack/i);
  });
});
