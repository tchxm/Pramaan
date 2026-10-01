import { describe, expect, it } from "vitest";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { buildProjectModel } from "../src/parser/project.js";
import { loadConfig } from "../src/config.js";
import { runDetectors, runDetectorsWithWarnings } from "../src/detectors/index.js";
import { findConfirmShamingCandidates } from "../src/detectors/confirmShamingCandidate.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "..", "fixtures");

interface ExpectedFinding {
  ruleId: string;
  file: string;
  count: number;
  score?: number;
  severity?: string;
  requiresReview?: boolean;
  firstVisibleStep?: string;
}

interface Expected {
  findings: ExpectedFinding[];
  totalFindings: number;
}

async function loadFixture(name: string) {
  const root = path.join(FIXTURES_ROOT, name);
  const config = await loadConfig(path.join(root, "pramaan.config.json"));
  const model = await buildProjectModel(root, config);
  const expected = JSON.parse(await readFile(path.join(root, "expected.json"), "utf-8")) as Expected;
  return { root, config, model, expected };
}

describe("detectors against real fixtures (spec Section 10)", () => {
  it("F01 basket-simple: PRM-001 x1 on Cart.tsx", async () => {
    const { model, config, expected } = await loadFixture("f01-basket-simple");
    const findings = runDetectors({ model, config });
    expect(findings.length).toBe(expected.totalFindings);
    const exp = expected.findings[0] as ExpectedFinding;
    const matching = findings.filter((f) => f.ruleId === exp.ruleId && f.location.file === exp.file);
    expect(matching.length).toBe(exp.count);
    expect(matching[0]?.findingId).toBe("F-PRM-001-1");
    expect(matching[0]?.score).toBeNull();
    expect(matching[0]?.requiresReview).toBe(false);
    expect(matching[0]?.regulation.length).toBeGreaterThan(0);
  });

  it("F02 css-cascade: PRM-003 x1, score exactly 1.00, severity high (worked example, spec 10.3)", async () => {
    const { model, config, expected } = await loadFixture("f02-css-cascade");
    const findings = runDetectors({ model, config });
    expect(findings.length).toBe(expected.totalFindings);
    const f = findings[0];
    expect(f?.ruleId).toBe("PRM-003");
    expect(f?.score).toBeCloseTo(1.0, 2);
    expect(f?.severity).toBe("high");
    expect(f?.requiresReview).toBe(true);
    expect(f?.title).toBe("Potential interface interference");
    // All 5 weighted signals should have fired per the worked example.
    const fired = f?.signals.filter((s) => s.fired).map((s) => s.id) ?? [];
    expect(fired).toContain("S1_CONTRAST_GAP");
    expect(fired).toContain("S2_SIZE_RATIO");
    expect(fired).toContain("S3_OPACITY");
    expect(fired).toContain("S4_WEIGHT_GAP");
    expect(fired).toContain("S5_LOW_ABSOLUTE_SIZE");
  });

  it("F04 negatives: zero findings from the four static detectors", async () => {
    const { model, config, expected } = await loadFixture("f04-negatives");
    const findings = runDetectors({ model, config });
    expect(findings.length).toBe(0);
    expect(expected.totalFindings).toBe(0);
  });

  it("F05 drip-pricing: PRM-004 x1 on Payment.tsx, firstVisibleStep 'payment'", async () => {
    const { model, config, expected } = await loadFixture("f05-drip-pricing");
    const findings = runDetectors({ model, config });
    expect(findings.length).toBe(expected.totalFindings);
    const f = findings[0];
    expect(f?.ruleId).toBe("PRM-004");
    expect(f?.location.file).toBe("src/pages/Payment.tsx");
    expect(f?.evidence.observed.firstVisibleStep).toBe("payment");
    expect(f?.score).toBeNull();
    expect(f?.requiresReview).toBe(false);
  });

  it("F06 mitti-mart: exactly 4 findings across PRM-001/002/003/004", async () => {
    const { model, config, expected } = await loadFixture("f06-mitti-mart");
    const findings = runDetectors({ model, config });
    expect(findings.length).toBe(4);
    expect(expected.totalFindings).toBe(4);
    const byRule = new Map<string, number>();
    for (const f of findings) byRule.set(f.ruleId, (byRule.get(f.ruleId) ?? 0) + 1);
    expect(byRule.get("PRM-001")).toBe(1);
    expect(byRule.get("PRM-002")).toBe(1);
    expect(byRule.get("PRM-003")).toBe(1);
    expect(byRule.get("PRM-004")).toBe(1);

    const prm002 = findings.find((f) => f.ruleId === "PRM-002");
    expect(prm002?.severity).toBe("high");
    const prm003 = findings.find((f) => f.ruleId === "PRM-003");
    expect(prm003?.score).toBeCloseTo(1.0, 2);
    expect(prm003?.requiresReview).toBe(true);
    const prm004 = findings.find((f) => f.ruleId === "PRM-004");
    expect(prm004?.evidence.observed.firstVisibleStep).toBe("payment");

    // findingId numbering is per-rule and stable (file/line/column sorted).
    for (const f of findings) {
      expect(f.findingId).toBe(`F-${f.ruleId}-1`);
      expect(f.attempts).toBe(0);
      expect(f.status).toBe("open");
      expect(f.regulation.length).toBeGreaterThan(0);
    }
  });

  it("F03 confirm-shaming: findConfirmShamingCandidates finds exactly 1 deterministic candidate (core never emits a PRM-005 Finding)", async () => {
    const { model, config } = await loadFixture("f03-confirm-shaming");
    const candidates = findConfirmShamingCandidates(model, config);
    expect(candidates.length).toBe(1);
    expect(candidates[0]?.anchorText.toLowerCase()).toContain("i prefer paying");

    // runDetectors() never includes PRM-005.
    const findings = runDetectors({ model, config });
    expect(findings.some((f) => f.ruleId === "PRM-005")).toBe(false);
  });

  it("runDetectorsWithWarnings surfaces PRICE_FLOW_NOT_CONFIGURED when checkoutFlow is absent", async () => {
    const { model, config } = await loadFixture("f01-basket-simple"); // no checkoutFlow in this fixture's config
    const { warnings } = runDetectorsWithWarnings({ model, config });
    expect(warnings.some((w) => w.code === "PRICE_FLOW_NOT_CONFIGURED")).toBe(true);
  });

  it("findings are ordered by file, then line, then column", async () => {
    const { model, config } = await loadFixture("f06-mitti-mart");
    const findings = runDetectors({ model, config });
    for (let i = 1; i < findings.length; i++) {
      const prev = findings[i - 1]!;
      const cur = findings[i]!;
      const key = (f: typeof prev) => `${f.location.file}|${String(f.location.startLine).padStart(6, "0")}|${String(f.location.startColumn).padStart(6, "0")}`;
      expect(key(prev) <= key(cur)).toBe(true);
    }
  });
});
