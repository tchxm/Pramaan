import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This file previously didn't exist — `npm run e2e` failed immediately
// with "config does not exist" rather than running anything. Spins up the
// real API server (fixture-backed, no LLM required — these tests cover
// navigation, deterministic scan results, and UI state, not the live
// agent loop, which is inherently slow/flaky on free-tier providers) and
// the real Vite dev server, then runs real browser tests against them.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      // No LLM env vars set here on purpose: these tests cover navigation,
      // the deterministic scan (which runs and completes before any LLM
      // call), and UI state — never a full live-agent remediation, which
      // is slow, costs real API quota, and is non-deterministic by nature
      // of hitting a real model. An audit started in these tests settles
      // on "Agent unavailable" after the scan, which is itself a real,
      // asserted UI state (see workspace.spec.ts).
      command: "node packages/server/dist/app.js",
      cwd: repoRoot,
      url: "http://localhost:8787/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "npm run dev --workspace=packages/web",
      cwd: repoRoot,
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
