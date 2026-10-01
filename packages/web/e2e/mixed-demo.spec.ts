import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("Run demo reaches one verified outcome, one proposal stop and two review-only stops", async ({ page, request }) => {
  test.setTimeout(60000);
  await page.goto("/audit");
  await page.getByRole("button", { name: /Run demo audit/ }).click();
  await expect(page).toHaveURL(/\/audit\/PRM-/);
  await expect(page.getByText("Scripted demo · actual engine execution.")).toBeVisible();
  await page.keyboard.press("Escape"); // Guided pane tour can be dismissed without stopping the run.
  await expect(page.getByRole("link", { name: "Open outcome & evidence →" })).toBeVisible({ timeout: 45000 });
  await page.getByRole("tab", { name: "Checkout preview", exact: true }).click();
  await expect(page.getByTestId("checkout-original").getByRole("checkbox")).toBeChecked();
  await expect(page.getByTestId("original-total")).toHaveText("₹887");
  await page.getByRole("button", { name: "Patched", exact: true }).click();
  await expect(page.getByTestId("checkout-patched").getByRole("checkbox")).not.toBeChecked();
  await expect(page.getByTestId("patched-total")).toHaveText("₹838");
  await page.getByTestId("checkout-patched").getByRole("checkbox").check();
  await expect(page.getByTestId("patched-total")).toHaveText("₹887");
  await page.getByRole("button", { name: "Reset shopper choices" }).click();
  await expect(page.getByTestId("patched-total")).toHaveText("₹838");
  const complete = page.getByTestId("finding-row-F-PRM-001-1");
  const midpoint = page.getByTestId("finding-row-F-PRM-002-1");
  await expect(complete).toContainText("Verified · evidence recorded");
  await expect(midpoint).toContainText("Stopped at proposal");
  await expect(page.locator(".ws-finding-row__progress").filter({ hasText: "No proposal · review needed" })).toHaveCount(2);
  await midpoint.click();
  await expect(page.locator(".scr-fix-proposal")).toContainText("timer.remove_display");
  await expect(page.locator(".ws-finding-journey")).toContainText("not applied");
  await page.getByTestId("finding-row-F-PRM-003-1").click();
  await expect(page.locator(".scr-fix-proposal")).toContainText("No fix proposed yet");
  await expect(page.locator(".ws-finding-journey")).toContainText("No fix proposal exists");
  await complete.click();
  await expect(page.locator(".ws-gates-panel")).toContainText("G4");
  const auditId = new URL(page.url()).pathname.split("/")[2];
  const pack = await (await request.get(`http://localhost:8787/api/audits/${auditId}/evidence`)).json();
  expect(pack.llm.mode).toBe("replay");
  expect(pack.findings.filter((f: any) => f.proposals.length === 0)).toHaveLength(2);
  expect(pack.findings.find((f: any) => f.finding.ruleId === "PRM-002").proposals[0].result.applied).toBe(false);
  expect(pack.findings.find((f: any) => f.finding.ruleId === "PRM-001").proposals[0].verify.verdict).toBe("VERIFIED");
  await page.getByRole("link", { name: "Open outcome & evidence →" }).click();
  await expect(page.getByRole("button", { name: "Download evidence pack" })).toBeVisible();
  await expect(page.getByTestId("outcome-before")).toHaveText("4");
  await expect(page.getByTestId("outcome-after")).toHaveText("3");
  await expect(page.getByRole("region", { name: "Audit result summary" })).toContainText("proposals not applied");
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download evidence pack" }).click();
  const download = await waiting;
  const file = await download.path();
  const downloaded = JSON.parse(await readFile(file!, "utf8"));
  expect(downloaded.evidenceHash).toBe(pack.evidenceHash);
  await page.reload();
  await expect(page.getByRole("button", { name: "Download evidence pack" })).toBeVisible();
  await page.goBack();
  await expect(midpoint).toContainText("Stopped at proposal");
});

test("saved walkthrough guided-run link selects the scripted scenario explicitly", async ({ page }) => {
  let body: any;
  await page.route("**/api/audits", async route => {
    if (route.request().method() !== "POST") return route.continue();
    body = route.request().postDataJSON();
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "Test stops before starting a second audit." } }) });
  });
  await page.goto("/demo");
  await page.getByRole("link", { name: "Run guided demo audit →" }).click();
  await expect.poll(() => body?.options?.demoScenario).toBe("mixed-outcomes");
  expect(body.source.id).toBe("f06-mitti-mart");
});
