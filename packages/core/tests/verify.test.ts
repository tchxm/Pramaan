import { describe, it, expect, afterAll, afterEach } from "vitest";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { loadConfig } from "../src/config.js";
import type { PramaanConfig } from "../src/config.js";
import { buildProjectModel } from "../src/parser/project.js";
import { createWorkspace, removeWorkspace, type Workspace } from "../src/workspace.js";
import type { ProjectModel } from "../src/parser/model.js";
import { proposePatch, applyPatch } from "../src/patch/apply.js";
import { computeProtectedManifest, type PolicyContext, type ProtectedElementEntry } from "../src/patch/policy.js";
import { runDetectorsWithWarnings, type DetectorWarning } from "../src/detectors/index.js";
import type { Finding, PatchProposal } from "../src/types.js";
import { verifyFinding, type VerifyFindingInput } from "../src/verify/gates.js";

const FIXTURES_ROOT = path.resolve(__dirname, "../../../fixtures");

// Determined via top-level await (NOT inside beforeAll): vitest evaluates
// `it.skipIf(...)` conditions during synchronous test collection, which
// happens BEFORE any beforeAll hook runs — so this must be resolved before
// `describe`/`it` are registered, or every `skipIf(!chromiumAvailable)`
// would see the un-initialized `false` default and skip unconditionally
// even when Chromium is available.
async function detectChromium(): Promise<boolean> {
  try {
    let b;
    try {
      b = await chromium.launch({ headless: true });
    } catch {
      b = await chromium.launch({ headless: true, channel: "chromium" });
    }
    await b.close();
    return true;
  } catch {
    // eslint-disable-next-line no-console
    console.warn(
      "[verify.test] Chromium could not be launched in this sandbox — G4 live-runtime assertions are SKIPPED. " +
        "See KNOWN RISKS in the A5 handoff report.",
    );
    return false;
  }
}
const chromiumAvailable = await detectChromium();

const prevRuntimeEnv = process.env.PRAMAAN_RUNTIME;
afterEach(() => {
  if (prevRuntimeEnv === undefined) delete process.env.PRAMAAN_RUNTIME;
  else process.env.PRAMAAN_RUNTIME = prevRuntimeEnv;
});

interface FixtureSetup {
  fixtureDir: string;
  config: PramaanConfig;
  workspace: Workspace;
  model: ProjectModel;
  baselineManifest: ProtectedElementEntry[];
  baselineFindings: Finding[];
  baselineWarnings: DetectorWarning[];
}

async function setupFixture(name: string, auditId: string): Promise<FixtureSetup> {
  const fixtureDir = path.join(FIXTURES_ROOT, name);
  const config = await loadConfig(path.join(fixtureDir, "pramaan.config.json"));
  const workspace = await createWorkspace(fixtureDir, auditId);
  const model = await buildProjectModel(workspace.root, config);
  const baselineManifest = computeProtectedManifest(model, config);
  const { findings: baselineFindings, warnings: baselineWarnings } = runDetectorsWithWarnings({ model, config });
  return { fixtureDir, config, workspace, model, baselineManifest, baselineFindings, baselineWarnings };
}

function basePolicyCtx(setup: FixtureSetup, finding: Finding): PolicyContext {
  return {
    auditId: setup.workspace.auditId,
    workspaceRoot: setup.workspace.root,
    scannedFiles: new Set(setup.workspace.files.keys()),
    protectedFingerprints: new Set(setup.baselineManifest.map((e) => e.fingerprint)),
    appliedProposalIds: new Set(),
    attemptsByFinding: new Map(),
    maxAttempts: 3,
    finding,
    approvalTokenVerifier: () => true,
  };
}

function gateOf(result: Awaited<ReturnType<typeof verifyFinding>>, gate: string) {
  const g = result.gates.find((g) => g.gate === gate);
  if (!g) throw new Error(`gate ${gate} missing from result`);
  return g;
}

// ============================================================
// F01 — checkbox.default_off -> VERIFIED (or STATIC_VERIFIED if runtime off)
// ============================================================

describe("T-V F01 verifyFinding — checkbox.default_off", () => {
  let setup: FixtureSetup;
  afterAll(async () => {
    if (setup) await removeWorkspace(setup.workspace);
  });

  it(
    "yields VERIFIED with live runtime, STATIC_VERIFIED with PRAMAAN_RUNTIME=off",
    async () => {
      setup = await setupFixture("f01-basket-simple", `test-v-f01-${Date.now()}`);
      const finding = setup.baselineFindings.find((f) => f.ruleId === "PRM-001");
      expect(finding).toBeDefined();

      const proposal = proposePatch({
        finding: finding!,
        strategy: "checkbox.default_off",
        params: {},
        projectModel: setup.model,
        config: setup.config,
      });
      const policyCtx = basePolicyCtx(setup, finding!);
      const applyResult = await applyPatch(setup.workspace, proposal, setup.config, policyCtx);
      expect(applyResult.applied).toBe(true);

      const input: VerifyFindingInput = {
        auditId: setup.workspace.auditId,
        findingId: finding!.findingId,
        finding: finding!,
        workspace: setup.workspace,
        config: setup.config,
        baselineManifest: setup.baselineManifest,
        baselineFindings: setup.baselineFindings,
        baselineWarnings: setup.baselineWarnings,
        appliedProposal: proposal,
      };

      if (!chromiumAvailable) {
        process.env.PRAMAAN_RUNTIME = "off";
        const result = await verifyFinding(input);
        expect(gateOf(result, "G1_DETECTOR_CLEAR").status).toBe("pass");
        expect(gateOf(result, "G2_PRESERVATION").status).toBe("pass");
        expect(gateOf(result, "G3_BUILD").status).toBe("pass");
        expect(gateOf(result, "G4_RUNTIME").status).toBe("not_run");
        expect(gateOf(result, "G5_NO_REGRESSION").status).toBe("pass");
        expect(result.verdict).toBe("STATIC_VERIFIED");
      } else {
        const result = await verifyFinding(input);
        expect(gateOf(result, "G1_DETECTOR_CLEAR").status).toBe("pass");
        expect(gateOf(result, "G2_PRESERVATION").status).toBe("pass");
        expect(gateOf(result, "G3_BUILD").status).toBe("pass");
        expect(gateOf(result, "G4_RUNTIME").status).toBe("pass");
        expect(gateOf(result, "G5_NO_REGRESSION").status).toBe("pass");
        expect(result.verdict).toBe("VERIFIED");
      }
    },
    90_000,
  );
});

// ============================================================
// F02 — the headline self-correction demo: own_rule fails CSS_OVERRIDE_WINS,
// winning_rule then passes G1.
// ============================================================

describe("T-V F02 verifyFinding — ii.normalize_reject_style self-correction", () => {
  let setupOwn: FixtureSetup;
  let setupWin: FixtureSetup;
  afterAll(async () => {
    if (setupOwn) await removeWorkspace(setupOwn.workspace);
    if (setupWin) await removeWorkspace(setupWin.workspace);
  });

  it(
    "own_rule: G1 FAILS with CSS_OVERRIDE_WINS (overrides.css !important still wins)",
    async () => {
      setupOwn = await setupFixture("f02-css-cascade", `test-v-f02own-${Date.now()}`);
      const finding = setupOwn.baselineFindings.find((f) => f.ruleId === "PRM-003");
      expect(finding).toBeDefined();

      const proposal = proposePatch({
        finding: finding!,
        strategy: "ii.normalize_reject_style",
        params: { scope: "own_rule" },
        projectModel: setupOwn.model,
        config: setupOwn.config,
      });
      const policyCtx = basePolicyCtx(setupOwn, finding!);
      const applyResult = await applyPatch(setupOwn.workspace, proposal, setupOwn.config, policyCtx);
      expect(applyResult.applied).toBe(true);

      process.env.PRAMAAN_RUNTIME = "off"; // static-only: this assertion is about G1, not G4
      const result = await verifyFinding({
        auditId: setupOwn.workspace.auditId,
        findingId: finding!.findingId,
        finding: finding!,
        workspace: setupOwn.workspace,
        config: setupOwn.config,
        baselineManifest: setupOwn.baselineManifest,
        baselineFindings: setupOwn.baselineFindings,
        baselineWarnings: setupOwn.baselineWarnings,
        appliedProposal: proposal,
      });

      const g1 = gateOf(result, "G1_DETECTOR_CLEAR");
      expect(g1.status).toBe("fail");
      expect(g1.details.code).toBe("CSS_OVERRIDE_WINS");
      expect(g1.details.winner).toMatchObject({
        file: "src/overrides.css",
        selector: ".checkout .decline",
        important: true,
      });
      expect(result.verdict).toBe("FAILED");
      expect(result.failureReasons.some((r) => r.code === "CSS_OVERRIDE_WINS")).toBe(true);
    },
    90_000,
  );

  it(
    "winning_rule: G1 PASSES (the actual winning cascade rule was fixed)",
    async () => {
      setupWin = await setupFixture("f02-css-cascade", `test-v-f02win-${Date.now()}`);
      const finding = setupWin.baselineFindings.find((f) => f.ruleId === "PRM-003");
      expect(finding).toBeDefined();

      const proposal = proposePatch({
        finding: finding!,
        strategy: "ii.normalize_reject_style",
        params: { scope: "winning_rule" },
        projectModel: setupWin.model,
        config: setupWin.config,
      });
      const policyCtx = basePolicyCtx(setupWin, finding!);
      const applyResult = await applyPatch(setupWin.workspace, proposal, setupWin.config, policyCtx);
      expect(applyResult.applied).toBe(true);

      const input: VerifyFindingInput = {
        auditId: setupWin.workspace.auditId,
        findingId: finding!.findingId,
        finding: finding!,
        workspace: setupWin.workspace,
        config: setupWin.config,
        baselineManifest: setupWin.baselineManifest,
        baselineFindings: setupWin.baselineFindings,
        baselineWarnings: setupWin.baselineWarnings,
        appliedProposal: proposal,
      };

      if (!chromiumAvailable) process.env.PRAMAAN_RUNTIME = "off";
      const result = await verifyFinding(input);

      const g1 = gateOf(result, "G1_DETECTOR_CLEAR");
      expect(g1.status).toBe("pass");
      expect(gateOf(result, "G2_PRESERVATION").status).toBe("pass");
      expect(gateOf(result, "G3_BUILD").status).toBe("pass");
      expect(gateOf(result, "G5_NO_REGRESSION").status).toBe("pass");

      if (chromiumAvailable) {
        // NOTE (KNOWN RISK, see handoff): this fixture's `.decline` rule
        // declares `background: transparent` directly on the element. The
        // locked static cascade engine (style/cascade.ts's
        // resolveBackgroundColor, out of scope to modify) treats that as
        // the element's OWN final background for contrast purposes and
        // does not composite further through to the page's real white
        // background — so the static engine measures #999999 as
        // high-contrast and never flags S1_CONTRAST_GAP (see the
        // identical observation in patch.test.ts). A real browser
        // composites `background: transparent` through to the actual page
        // background (white here), which genuinely fails WCAG 4.5:1 for
        // #999999. `ii.normalize_reject_style` only rewrites properties
        // the static engine flagged as failing (opacity, font-size for
        // this fixture) — color was never touched, because G1 never saw
        // it as broken. G4 is authoritative over G1 here (I-01: it reads
        // real DOM facts, not the approximation) and correctly fails with
        // a genuine low-contrast observation. This is exactly the kind of
        // static/runtime divergence G4 exists to catch — so the fixture's
        // "ideally VERIFIED" outcome is not reached live; the headline
        // CSS_OVERRIDE_WINS self-correction (G1) still fully holds.
        const g4 = gateOf(result, "G4_RUNTIME");
        expect(g4.status).toBe("fail");
        const observed = (g4.details as { observed?: { contrast?: number } }).observed;
        expect(observed?.contrast).toBeLessThan(4.5);
        expect(result.verdict).toBe("FAILED");
      } else {
        expect(gateOf(result, "G4_RUNTIME").status).toBe("not_run");
        expect(result.verdict).toBe("STATIC_VERIFIED");
      }
    },
    90_000,
  );
});

// ============================================================
// F08b — out-of-band deletion of a protected element -> G2 PRESERVATION_BROKEN
// ============================================================

describe("T-V F08b verifyFinding — preservation gate catches an out-of-band deletion", () => {
  let setup: FixtureSetup;
  afterAll(async () => {
    if (setup) await removeWorkspace(setup.workspace);
  });

  it(
    "G1 clear (element gone), G2 FAILS PRESERVATION_BROKEN, verdict FAILED",
    async () => {
      setup = await setupFixture("f08-cheat-attempts", `test-v-f08b-${Date.now()}`);
      const finding = setup.baselineFindings.find((f) => f.ruleId === "PRM-003");
      expect(finding).toBeDefined();

      const cartPath = path.join(setup.workspace.root, "src/pages/Cart.tsx");
      const before = await readFile(cartPath, "utf-8");
      // Test-only applyUnsafe: delete the protected "No thanks" button directly,
      // bypassing applyPatch/policy entirely (F08b setup per spec 19.8).
      const mutated = before.replace(
        /\{\/\* Protected element:[^]*?<\/button>\s*/,
        "",
      );
      expect(mutated).not.toContain("No thanks");
      await writeFile(cartPath, mutated, "utf-8");

      process.env.PRAMAAN_RUNTIME = "off";
      const result = await verifyFinding({
        auditId: setup.workspace.auditId,
        findingId: finding!.findingId,
        finding: finding!,
        workspace: setup.workspace,
        config: setup.config,
        baselineManifest: setup.baselineManifest,
        baselineFindings: setup.baselineFindings,
        baselineWarnings: setup.baselineWarnings,
      });

      expect(gateOf(result, "G1_DETECTOR_CLEAR").status).toBe("pass");
      const g2 = gateOf(result, "G2_PRESERVATION");
      expect(g2.status).toBe("fail");
      expect(g2.details.code).toBe("PRESERVATION_BROKEN");
      expect(Array.isArray(g2.details.missing)).toBe(true);
      expect((g2.details.missing as unknown[]).length).toBeGreaterThan(0);
      expect(result.verdict).toBe("FAILED");
    },
    60_000,
  );
});

// ============================================================
// F08c — inline style={{opacity:1}} does not beat !important -> CSS_OVERRIDE_WINS
// ============================================================

describe("T-V F08c verifyFinding — inline style does not beat !important", () => {
  let setup: FixtureSetup;
  afterAll(async () => {
    if (setup) await removeWorkspace(setup.workspace);
  });

  it(
    "G1 fails CSS_OVERRIDE_WINS, and G4 fails too when live runtime is available",
    async () => {
      setup = await setupFixture("f08-cheat-attempts", `test-v-f08c-${Date.now()}`);
      const finding = setup.baselineFindings.find((f) => f.ruleId === "PRM-003");
      expect(finding).toBeDefined();

      const cartPath = path.join(setup.workspace.root, "src/pages/Cart.tsx");
      const before = await readFile(cartPath, "utf-8");
      const mutated = before.replace(
        '<button className="decline" ref={declineRef} data-protected="true">',
        '<button className="decline" ref={declineRef} data-protected="true" style={{opacity: 1}}>',
      );
      expect(mutated).toContain("style={{opacity: 1}}");
      await writeFile(cartPath, mutated, "utf-8");

      const input: VerifyFindingInput = {
        auditId: setup.workspace.auditId,
        findingId: finding!.findingId,
        finding: finding!,
        workspace: setup.workspace,
        config: setup.config,
        baselineManifest: setup.baselineManifest,
        baselineFindings: setup.baselineFindings,
        baselineWarnings: setup.baselineWarnings,
      };

      if (!chromiumAvailable) process.env.PRAMAAN_RUNTIME = "off";
      const result = await verifyFinding(input);

      const g1 = gateOf(result, "G1_DETECTOR_CLEAR");
      expect(g1.status).toBe("fail");
      expect(g1.details.code).toBe("CSS_OVERRIDE_WINS");
      expect(g1.details.winner).toMatchObject({
        file: "src/overrides.css",
        selector: ".checkout .decline",
        important: true,
      });

      if (chromiumAvailable) {
        expect(gateOf(result, "G4_RUNTIME").status).toBe("fail");
      } else {
        // eslint-disable-next-line no-console
        console.warn("[verify.test] F08c live-G4 assertion skipped — Chromium unavailable in this sandbox.");
      }
      expect(result.verdict).toBe("FAILED");
    },
    60_000,
  );
});

// ============================================================
// F08e — runtime-only ref mutation is invisible to static analysis: G1
// passes (after a real CSS fix), G4 MUST fail RUNTIME_MISMATCH.
// ============================================================

describe("T-V F08e verifyFinding — runtime-only mutation caught only by G4", () => {
  let setup: FixtureSetup;
  afterAll(async () => {
    if (setup) await removeWorkspace(setup.workspace);
  });

  it.skipIf(!chromiumAvailable)(
    "G1 passes after a real static fix, G4 fails RUNTIME_MISMATCH because of the post-mount ref.style mutation",
    async () => {
      setup = await setupFixture("f08-cheat-attempts", `test-v-f08e-${Date.now()}`);
      const finding = setup.baselineFindings.find((f) => f.ruleId === "PRM-003");
      expect(finding).toBeDefined();

      // Apply a REAL patch (winning_rule) so the static source is genuinely
      // fixed — this fixture's Cart.tsx already contains the useEffect that
      // sets declineRef.current.style.opacity = "0.3" ~50ms after mount
      // (spec 19.8 F08e), independent of anything the patch touches.
      const proposal = proposePatch({
        finding: finding!,
        strategy: "ii.normalize_reject_style",
        params: { scope: "winning_rule" },
        projectModel: setup.model,
        config: setup.config,
      });
      const policyCtx = basePolicyCtx(setup, finding!);
      const applyResult = await applyPatch(setup.workspace, proposal, setup.config, policyCtx);
      expect(applyResult.applied).toBe(true);

      const result = await verifyFinding({
        auditId: setup.workspace.auditId,
        findingId: finding!.findingId,
        finding: finding!,
        workspace: setup.workspace,
        config: setup.config,
        baselineManifest: setup.baselineManifest,
        baselineFindings: setup.baselineFindings,
        baselineWarnings: setup.baselineWarnings,
        appliedProposal: proposal,
      });

      expect(gateOf(result, "G1_DETECTOR_CLEAR").status).toBe("pass");
      expect(gateOf(result, "G4_RUNTIME").status).toBe("fail");
      expect(result.verdict).toBe("FAILED");
    },
    60_000,
  );
});

// ============================================================
// G4 environment handling
// ============================================================

describe("T-V G4 environment handling", () => {
  it("PRAMAAN_RUNTIME=off yields not_run for every finding without starting a browser", async () => {
    const setup = await setupFixture("f01-basket-simple", `test-v-g4off-${Date.now()}`);
    try {
      const finding = setup.baselineFindings.find((f) => f.ruleId === "PRM-001")!;
      process.env.PRAMAAN_RUNTIME = "off";
      const { runRuntimeGate } = await import("../src/verify/runtime.js");
      const map = await runRuntimeGate([finding], setup.workspace, setup.config);
      expect(map.get(finding.findingId)?.status).toBe("not_run");
    } finally {
      await removeWorkspace(setup.workspace);
    }
  }, 30_000);

  it("ROUTE_UNKNOWN produces an explicit fail, never a silent skip", async () => {
    const setup = await setupFixture("f01-basket-simple", `test-v-routeunknown-${Date.now()}`);
    try {
      const finding = setup.baselineFindings.find((f) => f.ruleId === "PRM-001")!;
      const configNoRoutes: PramaanConfig = {
        ...setup.config,
        runtime: { ...setup.config.runtime, routes: {} },
      };
      if (!chromiumAvailable) {
        // Exercise resolveRoute directly when a live browser can't be started.
        const { resolveRoute } = await import("../src/verify/probes.js");
        expect(resolveRoute(finding.location.file, configNoRoutes)).toBeNull();
        return;
      }
      const { runRuntimeGate } = await import("../src/verify/runtime.js");
      const map = await runRuntimeGate([finding], setup.workspace, configNoRoutes);
      const g4 = map.get(finding.findingId);
      expect(g4?.status).toBe("fail");
      expect(g4?.details.reason ?? (g4?.details.observed as Record<string, unknown> | undefined)?.reason).toBe(
        "ROUTE_UNKNOWN",
      );
    } finally {
      await removeWorkspace(setup.workspace);
    }
  }, 30_000);
});
