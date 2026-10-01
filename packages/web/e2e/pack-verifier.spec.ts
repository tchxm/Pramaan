import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("pramaan:boot-shown", "1"));
});

// Both fixtures are real evidence packs produced by the actual engine (not
// hand-authored JSON) — valid-evidence-pack.json is an untouched real pack;
// tampered-evidence-pack.json is the same pack with one field changed after
// its hash was computed. Both were independently confirmed against the
// real `verifyEvidencePack` before being checked in — see the commit that
// added this spec for how.
test.describe("evidence pack verification", () => {
  test("an untampered real evidence pack verifies as intact", async ({ page }) => {
    await page.goto("/verify");
    await page.locator('input[type="file"]').setInputFiles(path.join(__dirname, "fixtures/valid-evidence-pack.json"));
    await page.getByRole("button", { name: /verify pack/i }).click();
    await expect(page.locator(".ws-pack-verifier__verdict--pass")).toBeVisible();
    await expect(page.getByText(/pack is intact/i)).toBeVisible();
  });

  test("a tampered evidence pack is caught, not waved through", async ({ page }) => {
    await page.goto("/verify");
    await page
      .locator('input[type="file"]')
      .setInputFiles(path.join(__dirname, "fixtures/tampered-evidence-pack.json"));
    await page.getByRole("button", { name: /verify pack/i }).click();
    await expect(page.locator(".ws-pack-verifier__verdict--fail")).toBeVisible();
    await expect(page.getByText(/pack has been altered/i)).toBeVisible();
  });
});
