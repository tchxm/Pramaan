// Runtime gate orchestration — Spec Section 13.1 (G4) / 13.2.
// startStaticServer -> launch headless Chromium -> runProbe per finding ->
// tear down. A genuine Chromium launch failure is a `fail` with
// E_RUNTIME_UNAVAILABLE, NEVER a silent pass and NEVER `not_run` (I-08:
// `not_run` is reserved exclusively for PRAMAAN_RUNTIME=off).

import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import type { Finding, GateResult } from "../types.js";
import type { PramaanConfig } from "../config.js";
import type { Workspace } from "../workspace.js";
import { startStaticServer, type StaticServerHandle } from "./staticServer.js";
import { runProbe, type ProbeResult } from "./probes.js";

async function loadChromium(): Promise<typeof import("playwright").chromium> {
  const pw = await import("playwright");
  return pw.chromium;
}

interface RuntimeSession {
  server: StaticServerHandle;
  browser: Browser;
  page: Page;
}

async function openSession(workspace: Workspace, config: PramaanConfig): Promise<RuntimeSession> {
  const outDir = path.join(workspace.root, config.runtime.outDir);
  const server = await startStaticServer(outDir);
  let browser: Browser;
  const chromium = await loadChromium();
  try {
    try {
      // Default: the bundled headless-shell build (`npx playwright install
      // chromium`'s usual artifact).
      browser = await chromium.launch({ headless: true });
    } catch (primaryCause) {
      // Fallback: some environments only have the full Chromium build
      // available (e.g. the headless-shell download failed/was blocked but
      // the full browser succeeded) — `channel: "chromium"` runs that build
      // headlessly instead of throwing E_RUNTIME_UNAVAILABLE unnecessarily.
      try {
        browser = await chromium.launch({ headless: true, channel: "chromium" });
      } catch {
        throw primaryCause;
      }
    }
  } catch (cause) {
    await server.close();
    throw cause;
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  return { server, browser, page };
}

async function closeSession(session: RuntimeSession): Promise<void> {
  await session.page.close().catch(() => undefined);
  await session.browser.close().catch(() => undefined);
  await session.server.close().catch(() => undefined);
}

function runtimeUnavailableGate(cause: unknown): GateResult {
  return {
    gate: "G4_RUNTIME",
    status: "fail",
    details: {
      code: "E_RUNTIME_UNAVAILABLE",
      message: cause instanceof Error ? cause.message : String(cause),
    },
  };
}

/** Runs the G4 runtime probe for each finding in `findings`, sharing one
 * static server + Chromium session across the whole batch for efficiency.
 * PRAMAAN_RUNTIME=off short-circuits to `not_run` for every finding WITHOUT
 * starting a server or a browser (I-08). A genuine Chromium launch failure
 * (E_RUNTIME_UNAVAILABLE) produces `fail` for every finding in the batch —
 * never a silent pass, never `not_run`. */
export async function runRuntimeGate(
  findings: Finding[],
  workspace: Workspace,
  config: PramaanConfig,
): Promise<Map<string, GateResult>> {
  const out = new Map<string, GateResult>();

  if (process.env.PRAMAAN_RUNTIME === "off") {
    for (const f of findings) {
      out.set(f.findingId, { gate: "G4_RUNTIME", status: "not_run", details: { reason: "PRAMAAN_RUNTIME=off" } });
    }
    return out;
  }

  let session: RuntimeSession;
  try {
    session = await openSession(workspace, config);
  } catch (cause) {
    const gate = runtimeUnavailableGate(cause);
    for (const f of findings) out.set(f.findingId, gate);
    return out;
  }

  try {
    for (const finding of findings) {
      try {
        const result: ProbeResult = await runProbe(finding.pattern, session.page, session.server.url, finding, config);
        out.set(finding.findingId, {
          gate: "G4_RUNTIME",
          status: result.pass ? "pass" : "fail",
          details: { observed: result.observed, ...(result.reason ? { reason: result.reason } : {}) },
        });
      } catch (cause) {
        out.set(finding.findingId, {
          gate: "G4_RUNTIME",
          status: "fail",
          details: { reason: "PROBE_ERROR", message: cause instanceof Error ? cause.message : String(cause) },
        });
      }
    }
  } finally {
    await closeSession(session);
  }

  return out;
}

export interface BaselineProbeRecord {
  findingId: string;
  observed: Record<string, unknown>;
  pass: boolean;
  screenshotPath: string;
}

async function captureScreenshotInternal(page: Page, destPath: string): Promise<void> {
  await mkdir(path.dirname(destPath), { recursive: true });
  await page.screenshot({ path: destPath });
}

/** Small helper for callers (evidence/CLI/server) that want a screenshot of
 * the current page state at a fixed destination path. Exported for reuse by
 * `runBaselineProbes` and by a later post-verify "after" capture. */
export async function captureScreenshot(page: Page, destPath: string): Promise<void> {
  await captureScreenshotInternal(page, destPath);
}

/** Runs the same probes against the UNPATCHED build (spec 13.2 last
 * paragraph) and stores `screenshots/<findingId>-before.png` plus the
 * observed values, for later diffing against the post-verify "after" state.
 * Not wired into the full audit flow here (that's the agent-loop owner's
 * job) — just callable and correct. Respects PRAMAAN_RUNTIME=off by
 * returning an empty list without starting a browser. */
export async function runBaselineProbes(
  findings: Finding[],
  workspace: Workspace,
  config: PramaanConfig,
  outDir: string,
): Promise<BaselineProbeRecord[]> {
  if (process.env.PRAMAAN_RUNTIME === "off") return [];

  const session = await openSession(workspace, config);
  const records: BaselineProbeRecord[] = [];
  try {
    for (const finding of findings) {
      const result = await runProbe(finding.pattern, session.page, session.server.url, finding, config).catch(
        (cause: unknown) => ({ pass: false, observed: { error: cause instanceof Error ? cause.message : String(cause) } }) as ProbeResult,
      );
      const screenshotPath = path.join(outDir, "screenshots", `${finding.findingId}-before.png`);
      await captureScreenshotInternal(session.page, screenshotPath).catch(() => undefined);
      records.push({ findingId: finding.findingId, observed: result.observed, pass: result.pass, screenshotPath });
    }
  } finally {
    await closeSession(session);
  }
  return records;
}
