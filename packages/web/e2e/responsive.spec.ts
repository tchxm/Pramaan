import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("pramaan:boot-shown", "1"));
});

const BREAKPOINTS = [
  { width: 1440, height: 900, name: "desktop-wide" },
  { width: 1280, height: 800, name: "desktop" },
  { width: 1024, height: 768, name: "tablet-landscape" },
  { width: 768, height: 1024, name: "tablet-portrait" },
  { width: 390, height: 844, name: "mobile" },
];

const ROUTES = ["/", "/audit", "/how-it-works", "/docs", "/verify"];

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

for (const bp of BREAKPOINTS) {
  test.describe(`${bp.name} (${bp.width}x${bp.height})`, () => {
    test.use({ viewport: { width: bp.width, height: bp.height } });

    for (const route of ROUTES) {
      test(`${route} has no horizontal overflow`, async ({ page }) => {
        await page.goto(route);
        await page.waitForTimeout(400);
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);
      });
    }
  });
}

test.describe("mobile workspace", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the workspace collapses to a single-column tabbed layout, not a squeezed 3-column grid", async ({
    page,
  }) => {
    await page.addInitScript(() => sessionStorage.setItem("pramaan:boot-shown", "1"));
    await page.goto("/audit");
    await page.getByRole("button", { name: /run demo audit/i }).click();
    await expect(page).toHaveURL(/\/audit\/PRM-/, { timeout: 15000 });
    await expect(page.locator(".scr-three-pane")).toHaveCount(0);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the home page renders a static fallback instead of the pinned scroll story", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".story--simple")).toBeVisible();
    await expect(page.locator(".story__stage")).toHaveCount(0);
  });
});
