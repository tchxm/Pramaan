import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("pramaan:boot-shown", "1"));
});

test.describe("start an audit", () => {
  test("the featured demo card starts a real audit and reaches the live workspace", async ({ page }) => {
    await page.goto("/audit");
    await page.getByRole("button", { name: /run demo audit/i }).click();
    await expect(page).toHaveURL(/\/audit\/PRM-/, { timeout: 15000 });
    await expect(page.locator(".scr-left-pane")).toBeVisible();
  });

  test("a fixture path audits a real project, not a canned fixture id", async ({ page }) => {
    await page.goto("/audit");
    await page.locator(".scr-path-input").fill("fixtures/f01-basket-simple");
    await page.getByRole("button", { name: /audit this project/i }).click();
    await expect(page).toHaveURL(/\/audit\/PRM-/, { timeout: 15000 });
  });

  test("advanced demo scenarios are reachable but not the first thing shown", async ({ page }) => {
    await page.goto("/audit");
    await expect(page.locator(".scr-fixture-table")).toHaveCount(0);
    await page.getByText("Advanced demo scenarios").click();
    await expect(page.locator(".scr-fixture-table")).toBeVisible();
  });
});

test.describe("live workspace", () => {
  test("the Mitti Mart fixture surfaces its four real deterministic findings", async ({ page }) => {
    await page.goto("/audit?fixture=f06-mitti-mart&tour=1");
    await expect(page).toHaveURL(/\/audit\/PRM-/, { timeout: 15000 });
    await expect(page.getByText("Countdown timer creates false urgency")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Checkbox pre-selected in a commercial context")).toBeVisible();
    await expect(page.getByText("Mandatory fee disclosed only at the last checkout step")).toBeVisible();
  });

  test("selecting a finding shows its real source and evidence, not placeholders", async ({ page }) => {
    await page.goto("/audit?fixture=f06-mitti-mart&tour=1", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/audit\/PRM-/, { timeout: 15000 });
    await page.getByText("Countdown timer creates false urgency").click();
    await expect(page.locator(".scr-center-pane")).toContainText("Cart.tsx");
    await expect(page.locator(".ws-gates-panel")).toBeVisible();
  });

  test("an unconfigured LLM provider shows a contextual notice, not a page-dominating error", async ({ page }) => {
    // This repo's e2e server intentionally runs without LLM env vars (see
    // playwright.config.ts) — "Agent unavailable" is the real, honest
    // state here, not a fabricated one.
    await page.goto("/audit?fixture=f06-mitti-mart&tour=1", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/audit\/PRM-/, { timeout: 15000 });
    const notice = page.locator(".scr-banner--notice");
    await expect(notice).toBeVisible({ timeout: 10000 });
    await expect(notice).toContainText(/agent unavailable/i);
    await expect(notice).toContainText(/deterministic detection is still available/i);
  });
});
