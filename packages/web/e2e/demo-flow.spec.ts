import { test, expect } from "@playwright/test";

test("saved demo works without API and refresh retains the selected step", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("pramaan:boot-shown", "1"));
  await page.route("**/api/**", route => route.abort());
  await page.goto("/");
  await page.getByRole("button", { name: "Watch the demo", exact: true }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByText("Your basket", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /What PRAMAAN finds/ }).click();
  await expect(page.locator(".demo-findings li")).toHaveCount(4);
  await page.getByRole("button", { name: /The engine checks/ }).click();
  await expect(page.locator(".demo-gates li")).toHaveCount(5);
  await expect(page.locator(".demo-gates b")).toHaveText(["pass", "pass", "pass", "pass", "pass"]);
  await page.reload();
  await expect(page.locator(".demo-verdict")).toContainText("VERIFIED");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: /Download saved audit JSON/ }).click();
  expect((await download).suggestedFilename()).toBe("mitti-mart.json");
  await page.goBack();
  await expect(page).toHaveURL("http://localhost:5173/");
  await expect(page.locator(".lp-gate")).toHaveCount(0);
});

test("entry replays on request, ordinary reload and Back preserve dismissal", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".lp-gate")).toBeVisible();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.locator(".lp-gate")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".lp-gate")).toHaveCount(0);
  await page.getByRole("button", { name: "Replay intro", exact: true }).click();
  await expect(page.locator(".lp-gate")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enter", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await expect(page.locator(".lp-gate")).toHaveCount(0);
});

test("Back from a live demo returns to the saved example without creating another audit", async ({ page }) => {
  let starts = 0;
  page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/api/audits")) starts++; });
  await page.goto("/demo");
  await page.getByRole("link", { name: "Run a live demo audit →", exact: true }).click();
  await expect(page).toHaveURL(/\/audit\/PRM-/, { timeout: 15000 });
  await expect(page.getByText("Checkbox pre-selected in a commercial context")).toBeVisible({ timeout: 10000 });
  await page.goBack();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.locator("h1")).toContainText("deceptive checkout");
  await page.waitForTimeout(600);
  expect(starts).toBe(1);
  await page.goForward();
  await expect(page).toHaveURL(/\/audit\/PRM-/);
  expect(starts).toBe(1);
});

test("leaving a pending live launch cannot redirect the user later", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/audits", async route => {
    if (route.request().method() !== "POST") return route.continue();
    await pending;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ auditId: "PRM-delayed" }) });
  });
  await page.goto("/demo");
  const request = page.waitForRequest(r => r.method() === "POST" && r.url().endsWith("/api/audits"));
  await page.getByRole("link", { name: "Run a live demo audit →", exact: true }).click();
  await request;
  await page.goBack();
  await expect(page).toHaveURL(/\/demo$/);
  release();
  await page.waitForTimeout(600);
  await expect(page).toHaveURL(/\/demo$/);
});
