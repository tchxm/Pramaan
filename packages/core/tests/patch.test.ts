import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../src/config.js";
import type { PramaanConfig } from "../src/config.js";
import { buildProjectModel } from "../src/parser/project.js";
import { createWorkspace, removeWorkspace, hashFile, type Workspace } from "../src/workspace.js";
import { parseJsxFile } from "../src/parser/jsx.js";
import type { JsxElementNode, ProjectModel } from "../src/parser/model.js";
import { computeFingerprint } from "../src/fingerprint.js";
import { proposePatch, applyPatch } from "../src/patch/apply.js";
import { checkPolicy, computeProtectedManifest, type PolicyContext } from "../src/patch/policy.js";
import { applyOp, type ApplyOpContext } from "../src/patch/ops.js";
import { falseUrgency } from "../src/detectors/falseUrgency.js";
import { runDetectorsWithWarnings } from "../src/detectors/index.js";
import { gate2Preservation, gate5NoRegression, verifyFinding } from "../src/verify/gates.js";
import type { Finding, PatchProposal, PatternId, RuleId, SourceLocation } from "../src/types.js";

const FIXTURES_ROOT = path.resolve(__dirname, "../../../fixtures");

function findByTag(root: JsxElementNode, tag: string, nth = 0): JsxElementNode {
  const matches: JsxElementNode[] = [];
  function walk(el: JsxElementNode): void {
    if (el.tag === tag) matches.push(el);
    for (const c of el.children) walk(c);
  }
  walk(root);
  const match = matches[nth];
  if (!match) throw new Error(`tag ${tag}[${nth}] not found`);
  return match;
}

function findByClass(root: JsxElementNode, cls: string): JsxElementNode {
  let found: JsxElementNode | null = null;
  function walk(el: JsxElementNode): void {
    if (found) return;
    const attr = el.attributes.find((a) => a.name === "className");
    if (typeof attr?.literalValue === "string" && attr.literalValue.split(/\s+/).includes(cls)) {
      found = el;
      return;
    }
    for (const c of el.children) walk(c);
  }
  walk(root);
  if (!found) throw new Error(`element with class "${cls}" not found`);
  return found;
}

function locationOf(el: JsxElementNode, file: string): SourceLocation {
  return {
    file,
    startLine: el.range.startLine,
    startColumn: el.range.startColumn,
    endLine: el.range.endLine,
    endColumn: el.range.endColumn,
  };
}

function makeFinding(opts: {
  ruleId: RuleId;
  pattern: PatternId;
  location: SourceLocation;
  fingerprint: string;
  findingId?: string;
}): Finding {
  return {
    findingId: opts.findingId ?? `F-${opts.ruleId}-1`,
    ruleId: opts.ruleId,
    pattern: opts.pattern,
    severity: "high",
    status: "open",
    detector: "AST",
    location: opts.location,
    fingerprint: opts.fingerprint,
    title: "test finding",
    evidence: { sourceSnippet: "", fileSha256: "", observed: {}, warnings: [] },
    signals: [],
    score: null,
    requiresReview: false,
    regulation: [],
    attempts: 0,
  };
}

function basePolicyCtx(workspace: Workspace, model: ProjectModel, config: PramaanConfig, finding: Finding): PolicyContext {
  const protectedEntries = computeProtectedManifest(model, config);
  return {
    auditId: workspace.auditId,
    workspaceRoot: workspace.root,
    scannedFiles: new Set(workspace.files.keys()),
    protectedFingerprints: new Set(protectedEntries.map((e) => e.fingerprint)),
    appliedProposalIds: new Set(),
    attemptsByFinding: new Map(),
    maxAttempts: 3,
    finding,
    approvalTokenVerifier: () => true,
  };
}

async function setupFixture(name: string, auditId: string) {
  const fixtureDir = path.join(FIXTURES_ROOT, name);
  const config = await loadConfig(path.join(fixtureDir, "pramaan.config.json"));
  const workspace = await createWorkspace(fixtureDir, auditId);
  const model = await buildProjectModel(workspace.root, config);
  return { fixtureDir, config, workspace, model };
}

it("removes only the f06 countdown display and preserves the basket and shopper controls", async () => {
  const { workspace, config, model } = await setupFixture("f06-mitti-mart", `timer-target-${Date.now()}`);
  try {
    const finding = falseUrgency(model, config)[0]!;
    const proposal = proposePatch({ finding, strategy: "timer.remove_display", params: {}, projectModel: model, config });
    const result = await applyPatch(workspace, proposal, config, basePolicyCtx(workspace, model, config, finding));
    expect(result.applied).toBe(true);
    const source = await readFile(path.join(workspace.root, finding.location.file), "utf8");
    expect(source).not.toContain("Offer expires in");
    expect(source).toContain("Organic Coffee — ₹799");
    expect(source).toContain("No thanks");
    expect(source).toContain("Proceed to payment");
    expect(source).toContain("checked={protection}");
    const current = await buildProjectModel(workspace.root, config);
    expect(falseUrgency(current, config)).toHaveLength(0);
    expect(gate2Preservation(current, config, computeProtectedManifest(model, config), finding, proposal).status).toBe("pass");
    const before = runDetectorsWithWarnings({model, config});
    const after = runDetectorsWithWarnings({model: current, config});
    expect(gate5NoRegression(after.findings, after.warnings, before.findings, before.warnings, proposal).status).toBe("pass");
    const verified = await verifyFinding({ auditId: workspace.auditId, findingId: finding.findingId, finding, workspace, config, baselineManifest: computeProtectedManifest(model, config), baselineFindings: before.findings, baselineWarnings: before.warnings, appliedProposal: proposal });
    expect(verified.verdict).toBe("VERIFIED");
  } finally { await removeWorkspace(workspace); }
}, 30000);

describe("T-PT F01 checkbox.default_off — SET_INITIAL_STATE_LITERAL", () => {
  let workspace: Workspace;
  let config: PramaanConfig;
  let model: ProjectModel;

  beforeAll(async () => {
    ({ config, workspace, model } = await setupFixture("f01-basket-simple", `test-f01-${Date.now()}`));
  });
  afterAll(async () => {
    await removeWorkspace(workspace);
  });

  it("rewrites useState(true) -> useState(false) for a bound checkbox", async () => {
    const file = model.files.find((f) => f.path === "src/pages/Cart.tsx");
    expect(file).toBeDefined();
    const component = file!.components.find((c) => c.name === "Cart");
    expect(component?.jsxRoot).toBeTruthy();
    const inputEl = findByTag(component!.jsxRoot!, "input");
    const location = locationOf(inputEl, file!.path);
    const fingerprint = computeFingerprint({
      ruleId: "PRM-001",
      file: file!.path,
      componentName: component!.name,
      jsxPath: inputEl.jsxPath,
      anchorText: "delivery protection",
    });
    const finding = makeFinding({ ruleId: "PRM-001", pattern: "BASKET_SNEAKING", location, fingerprint });

    const proposal = proposePatch({ finding, strategy: "checkbox.default_off", params: {}, projectModel: model, config });
    expect(proposal.ops).toHaveLength(1);
    expect(proposal.ops[0]!.kind).toBe("SET_INITIAL_STATE_LITERAL");
    expect(proposal.ops[0]!.params.stateName).toBe("protection");
    expect(proposal.ops[0]!.params.to).toBe(false);

    const policyCtx = basePolicyCtx(workspace, model, config, finding);
    const result = await applyPatch(workspace, proposal, config, policyCtx);
    expect(result.policyViolations).toEqual([]);
    expect(result.applied).toBe(true);
    expect(result.filesChanged).toEqual(["src/pages/Cart.tsx"]);

    const after = await readFile(path.join(workspace.root, "src/pages/Cart.tsx"), "utf-8");
    expect(after).toContain("useState(false)");
    const reparsed = parseJsxFile("src/pages/Cart.tsx", after);
    expect(reparsed.parseError).toBeUndefined();
  });
});

describe("checkbox.default_off — WIRE_CONTROLLED_CHECKBOX (unbound checkbox)", () => {
  it("wires a fresh controlled state when checked is not a useState(true) getter", () => {
    const filePath = "src/pages/Cart.tsx";
    const source = `export default function Cart() {\n  return (\n    <div>\n      <input type="checkbox" checked={true} />\n      Protect\n    </div>\n  );\n}\n`;
    const { components } = parseJsxFile(filePath, source);
    const component = components[0]!;
    const inputEl = findByTag(component.jsxRoot!, "input");
    const location = locationOf(inputEl, filePath);
    const fingerprint = computeFingerprint({
      ruleId: "PRM-001",
      file: filePath,
      componentName: component.name,
      jsxPath: inputEl.jsxPath,
      anchorText: "protect",
    });
    const finding = makeFinding({ ruleId: "PRM-001", pattern: "BASKET_SNEAKING", location, fingerprint });
    const config: PramaanConfig = {
      srcRoot: "src",
      entry: "src/main.tsx",
      checkboxComponents: ["Checkbox"],
      buttonComponents: [],
      currency: ["₹", "Rs", "INR"],
      runtime: { buildCommand: "npm run build", outDir: "dist" },
      configHash: "test",
    };
    const model: ProjectModel = {
      srcRoot: "src",
      files: [{ path: filePath, sha256: "x", source, components }],
      cssFiles: [],
      warnings: [],
    };

    const proposal = proposePatch({
      finding,
      strategy: "checkbox.default_off",
      params: { stateName: "accepted", setterName: "setAccepted" },
      projectModel: model,
      config,
    });
    expect(proposal.ops).toHaveLength(1);
    expect(proposal.ops[0]!.kind).toBe("WIRE_CONTROLLED_CHECKBOX");

    const ctx: ApplyOpContext = { files: new Map([[filePath, source]]), createdFiles: new Set(), config, finding };
    applyOp(proposal.ops[0]!, ctx);
    const newSource = ctx.files.get(filePath)!;
    expect(newSource).toContain("checked={accepted}");
    expect(newSource).toContain("onChange={(e) => setAccepted(e.target.checked)}");
    expect(newSource).toContain("const [accepted, setAccepted] = useState(false);");
    expect(newSource).toContain('import { useState } from "react";');
    const reparsed = parseJsxFile(filePath, newSource);
    expect(reparsed.parseError).toBeUndefined();
  });
});

describe("T-PT F01 variant — WIRE_CONTROLLED_CHECKBOX via full applyPatch", () => {
  it("wires a controlled state for the variant's literal checked={true} checkbox", async () => {
    const { config, workspace, model } = await setupFixture("f01-basket-simple/variant", `test-f01variant-${Date.now()}`);
    try {
      const file = model.files.find((f) => f.path === "src/pages/Cart.tsx")!;
      const component = file.components.find((c) => c.name === "Cart")!;
      const inputEl = findByTag(component.jsxRoot!, "input");
      const location = locationOf(inputEl, file.path);
      const fingerprint = computeFingerprint({
        ruleId: "PRM-001",
        file: file.path,
        componentName: component.name,
        jsxPath: inputEl.jsxPath,
        anchorText: "delivery protection",
      });
      const finding = makeFinding({ ruleId: "PRM-001", pattern: "BASKET_SNEAKING", location, fingerprint });

      const proposal = proposePatch({
        finding,
        strategy: "checkbox.default_off",
        params: { stateName: "protection", setterName: "setProtection" },
        projectModel: model,
        config,
      });
      expect(proposal.ops[0]!.kind).toBe("WIRE_CONTROLLED_CHECKBOX");

      const policyCtx = basePolicyCtx(workspace, model, config, finding);
      const result = await applyPatch(workspace, proposal, config, policyCtx);
      expect(result.policyViolations).toEqual([]);
      expect(result.applied).toBe(true);

      const after = await readFile(path.join(workspace.root, "src/pages/Cart.tsx"), "utf-8");
      expect(after).toContain("checked={protection}");
      expect(after).toContain("const [protection, setProtection] = useState(false);");
      const reparsed = parseJsxFile("src/pages/Cart.tsx", after);
      expect(reparsed.parseError).toBeUndefined();
    } finally {
      await removeWorkspace(workspace);
    }
  });
});

describe("T-PT F02 ii.normalize_reject_style — own_rule vs winning_rule", () => {
  it("own_rule targets .decline in styles.css", async () => {
    const { config, workspace, model } = await setupFixture("f02-css-cascade", `test-f02own-${Date.now()}`);
    try {
      const file = model.files.find((f) => f.path === "src/pages/Cart.tsx")!;
      const component = file.components[0]!;
      const declineEl = findByClass(component.jsxRoot!, "decline");
      const location = locationOf(declineEl, file.path);
      const fingerprint = computeFingerprint({
        ruleId: "PRM-003",
        file: file.path,
        componentName: component.name,
        jsxPath: declineEl.jsxPath,
        anchorText: "no thanks",
      });
      const finding = makeFinding({ ruleId: "PRM-003", pattern: "INTERFACE_INTERFERENCE", location, fingerprint });

      const proposal = proposePatch({
        finding,
        strategy: "ii.normalize_reject_style",
        params: { scope: "own_rule" },
        projectModel: model,
        config,
      });
      const cssOps = proposal.ops.filter((o) => o.kind === "SET_CSS_DECLARATION");
      expect(cssOps.length).toBeGreaterThan(0);
      for (const op of cssOps) {
        expect(op.file).toBe("src/styles.css");
        expect(op.params.selector).toBe(".decline");
      }
      // NOTE: this fixture's `.decline` rule declares `background: transparent`,
      // which style/color.ts resolves to rgba(0,0,0,0) and the locked
      // resolveBackgroundColor treats as an opaque background for contrast
      // purposes (it does not further composite against ancestors here) —
      // so #999999 measures as high-contrast against it and `color` is not
      // flagged as failing in this specific fixture. See KNOWN RISKS.
      const props = cssOps.map((o) => o.params.property).sort();
      expect(props).toEqual(expect.arrayContaining(["opacity", "font-size"]));

      const policyCtx = basePolicyCtx(workspace, model, config, finding);
      const result = await applyPatch(workspace, proposal, config, policyCtx);
      expect(result.policyViolations).toEqual([]);
      expect(result.applied).toBe(true);

      const cssAfter = await readFile(path.join(workspace.root, "src/styles.css"), "utf-8");
      expect(cssAfter).toMatch(/\.decline\s*\{[^}]*opacity:\s*1;/);
    } finally {
      await removeWorkspace(workspace);
    }
  });

  it("winning_rule targets .checkout .decline in overrides.css and removes !important", async () => {
    const { config, workspace, model } = await setupFixture("f02-css-cascade", `test-f02win-${Date.now()}`);
    try {
      const file = model.files.find((f) => f.path === "src/pages/Cart.tsx")!;
      const component = file.components[0]!;
      const declineEl = findByClass(component.jsxRoot!, "decline");
      const location = locationOf(declineEl, file.path);
      const fingerprint = computeFingerprint({
        ruleId: "PRM-003",
        file: file.path,
        componentName: component.name,
        jsxPath: declineEl.jsxPath,
        anchorText: "no thanks",
      });
      const finding = makeFinding({ ruleId: "PRM-003", pattern: "INTERFACE_INTERFERENCE", location, fingerprint });

      const proposal = proposePatch({
        finding,
        strategy: "ii.normalize_reject_style",
        params: { scope: "winning_rule" },
        projectModel: model,
        config,
      });
      const cssOps = proposal.ops.filter((o) => o.kind === "SET_CSS_DECLARATION");
      const opacityOp = cssOps.find((o) => o.params.property === "opacity");
      expect(opacityOp?.file).toBe("src/overrides.css");
      expect(opacityOp?.params.selector).toBe(".checkout .decline");
      const importantOps = proposal.ops.filter((o) => o.kind === "REMOVE_CSS_IMPORTANT");
      expect(importantOps.length).toBeGreaterThan(0);
      expect(importantOps[0]!.file).toBe("src/overrides.css");

      const policyCtx = basePolicyCtx(workspace, model, config, finding);
      const result = await applyPatch(workspace, proposal, config, policyCtx);
      expect(result.policyViolations).toEqual([]);
      expect(result.applied).toBe(true);

      const overridesAfter = await readFile(path.join(workspace.root, "src/overrides.css"), "utf-8");
      expect(overridesAfter).not.toMatch(/!important/);
      expect(overridesAfter).toMatch(/opacity:\s*1;/);
    } finally {
      await removeWorkspace(workspace);
    }
  });
});

describe("T-PT F05 pricing.disclose_fee_early — INSERT_FEE_DISCLOSURE", () => {
  it("creates FeeDisclosure.tsx from the template and inserts it into the step-0 file", async () => {
    const { config, workspace, model } = await setupFixture("f05-drip-pricing", `test-f05-${Date.now()}`);
    try {
      const location: SourceLocation = { file: "src/pages/Payment.tsx", startLine: 1, startColumn: 0, endLine: 1, endColumn: 1 };
      const fingerprint = computeFingerprint({
        ruleId: "PRM-004",
        file: "src/pages/Payment.tsx",
        componentName: "Payment",
        jsxPath: "0",
        anchorText: "handling fee",
      });
      const finding = makeFinding({ ruleId: "PRM-004", pattern: "DRIP_PRICING", location, fingerprint });

      const proposal = proposePatch({
        finding,
        strategy: "pricing.disclose_fee_early",
        params: { constKey: "protection", label: "Delivery Protection" },
        projectModel: model,
        config,
      });
      expect(proposal.ops).toHaveLength(1);
      expect(proposal.ops[0]!.kind).toBe("INSERT_FEE_DISCLOSURE");
      expect(proposal.ops[0]!.file).toBe("src/pages/Product.tsx");

      const policyCtx = basePolicyCtx(workspace, model, config, finding);
      const result = await applyPatch(workspace, proposal, config, policyCtx);
      expect(result.policyViolations).toEqual([]);
      expect(result.applied).toBe(true);
      expect(result.filesChanged).toEqual(
        expect.arrayContaining(["src/components/FeeDisclosure.tsx", "src/pages/Product.tsx"]),
      );

      const feeSrc = await readFile(path.join(workspace.root, "src/components/FeeDisclosure.tsx"), "utf-8");
      expect(feeSrc).toContain("FEES.protection");
      expect(feeSrc).toContain("Delivery Protection");
      expect(feeSrc).toContain('import { FEES } from "../constants/fees";');
      const reparsedFee = parseJsxFile("src/components/FeeDisclosure.tsx", feeSrc);
      expect(reparsedFee.parseError).toBeUndefined();

      const productSrc = await readFile(path.join(workspace.root, "src/pages/Product.tsx"), "utf-8");
      expect(productSrc).toContain("<FeeDisclosure");
      expect(productSrc).toMatch(/import FeeDisclosure from ".*components\/FeeDisclosure"/);
      const reparsedProduct = parseJsxFile("src/pages/Product.tsx", productSrc);
      expect(reparsedProduct.parseError).toBeUndefined();
    } finally {
      await removeWorkspace(workspace);
    }
  });

  it("rejects an unknown fee constant with E_TARGET_NOT_FOUND", async () => {
    const { config, model } = await setupFixture("f05-drip-pricing", `test-f05bad-${Date.now()}`);
    const location: SourceLocation = { file: "src/pages/Payment.tsx", startLine: 1, startColumn: 0, endLine: 1, endColumn: 1 };
    const finding = makeFinding({
      ruleId: "PRM-004",
      pattern: "DRIP_PRICING",
      location,
      fingerprint: "deadbeef",
    });
    expect(() =>
      proposePatch({
        finding,
        strategy: "pricing.disclose_fee_early",
        params: { constKey: "doesNotExist", label: "Handling Fee" },
        projectModel: model,
        config,
      }),
    ).toThrowError(/E_TARGET_NOT_FOUND|fee constant/);
  });
});

describe("T-PO F08a — protected element rejection", () => {
  it("rejects REMOVE_JSX_ELEMENT on the protected \"No thanks\" button with E_PROTECTED_ELEMENT", async () => {
    const { fixtureDir, config, workspace, model } = await setupFixture("f08-cheat-attempts", `test-f08a-${Date.now()}`);
    try {
      const file = model.files.find((f) => f.path === "src/pages/Cart.tsx")!;
      const component = file.components[0]!;
      const declineBtn = findByClass(component.jsxRoot!, "decline");
      const location = locationOf(declineBtn, file.path);
      // Deliberately NOT FALSE_URGENCY — the 12.3 exception must not apply.
      const fingerprint = computeFingerprint({
        ruleId: "PRM-002",
        file: file.path,
        componentName: component.name,
        jsxPath: declineBtn.jsxPath,
        anchorText: "no thanks",
      });
      const finding = makeFinding({ ruleId: "PRM-002", pattern: "BASKET_SNEAKING", location, fingerprint });

      const policyCtx = basePolicyCtx(workspace, model, config, finding);
      expect(policyCtx.protectedFingerprints.has(finding.fingerprint)).toBe(true);

      const proposal: PatchProposal = {
        proposalId: "pp-f08a",
        findingId: finding.findingId,
        strategy: "manual.remove",
        rationale: "adversarial test — direct engine call bypassing the agent",
        ops: [
          {
            opId: "op-f08a-1",
            kind: "REMOVE_JSX_ELEMENT",
            file: file.path,
            target: { fingerprint: finding.fingerprint },
            params: {},
          },
        ],
        risk: "deterministic",
        requiresApproval: false,
      };

      const violations = checkPolicy(proposal, policyCtx);
      expect(violations.some((v) => v.code === "E_PROTECTED_ELEMENT")).toBe(true);

      const result = await applyPatch(workspace, proposal, config, policyCtx);
      expect(result.applied).toBe(false);
      expect(result.filesChanged).toEqual([]);
      expect(result.policyViolations.some((v) => v.code === "E_PROTECTED_ELEMENT")).toBe(true);

      const before = await readFile(path.join(fixtureDir, "src/pages/Cart.tsx"), "utf-8");
      const after = await readFile(path.join(workspace.root, "src/pages/Cart.tsx"), "utf-8");
      expect(after).toBe(before);
    } finally {
      await removeWorkspace(workspace);
    }
  });
});

describe("T-PO-11 / F08d — rollback on parse failure is byte-identical", () => {
  it("restores the whole workspace to its pre-patch state when a patch introduces a syntax error", async () => {
    const { config, workspace, model } = await setupFixture("f08-cheat-attempts", `test-f08d-${Date.now()}`);
    try {
      const trackedPaths = [...workspace.files.keys()];
      const beforeHashes = new Map<string, string>();
      for (const rel of trackedPaths) {
        beforeHashes.set(rel, await hashFile(path.join(workspace.root, rel)));
      }

      const file = model.files.find((f) => f.path === "src/pages/Cart.tsx")!;
      const component = file.components[0]!;
      const declineBtn = findByClass(component.jsxRoot!, "decline");
      const location = locationOf(declineBtn, file.path);
      const fingerprint = computeFingerprint({
        ruleId: "PRM-005",
        file: file.path,
        componentName: component.name,
        jsxPath: declineBtn.jsxPath,
        anchorText: "no thanks",
      });
      const finding = makeFinding({ ruleId: "PRM-005", pattern: "CONFIRM_SHAMING", location, fingerprint });

      const proposal: PatchProposal = {
        proposalId: "pp-f08d",
        findingId: finding.findingId,
        strategy: "manual.break",
        rationale: "adversarial test — deliberately invalid TSX edit",
        ops: [
          {
            opId: "op-f08d-1",
            kind: "REPLACE_JSX_TEXT",
            file: file.path,
            target: { fingerprint: finding.fingerprint },
            params: { from: "No thanks", to: "<broken", approvalToken: "test-token" },
          },
        ],
        risk: "semantic",
        requiresApproval: true,
      };

      const policyCtx = basePolicyCtx(workspace, model, config, finding);
      const result = await applyPatch(workspace, proposal, config, policyCtx);
      expect(result.applied).toBe(false);
      expect(result.filesChanged).toEqual([]);
      expect(result.policyViolations[0]!.code).toBe("E_PATCH_PARSE_ERROR");

      for (const rel of trackedPaths) {
        const afterHash = await hashFile(path.join(workspace.root, rel));
        expect(afterHash).toBe(beforeHashes.get(rel));
      }
    } finally {
      await removeWorkspace(workspace);
    }
  });
});

describe("T-PO policy unit checks (P1-P10)", () => {
  const location: SourceLocation = { file: "src/pages/Cart.tsx", startLine: 1, startColumn: 0, endLine: 1, endColumn: 1 };
  const finding = makeFinding({ ruleId: "PRM-001", pattern: "BASKET_SNEAKING", location, fingerprint: "abc123" });

  function baseCtx(overrides: Partial<PolicyContext> = {}): PolicyContext {
    return {
      auditId: "audit-1",
      workspaceRoot: path.resolve("/tmp/workspace-root"),
      scannedFiles: new Set(["src/pages/Cart.tsx"]),
      protectedFingerprints: new Set(),
      appliedProposalIds: new Set(),
      attemptsByFinding: new Map(),
      maxAttempts: 3,
      finding,
      approvalTokenVerifier: () => true,
      ...overrides,
    };
  }

  function baseProposal(overrides: Partial<PatchProposal> = {}): PatchProposal {
    return {
      proposalId: "pp-1",
      findingId: finding.findingId,
      strategy: "checkbox.default_off",
      rationale: "test",
      ops: [
        { opId: "op-1", kind: "SET_INITIAL_STATE_LITERAL", file: "src/pages/Cart.tsx", target: {}, params: { stateName: "x", from: true, to: false } },
      ],
      risk: "deterministic",
      requiresApproval: false,
      ...overrides,
    };
  }

  it("P1: rejects an op kind outside the whitelist", () => {
    const proposal = baseProposal({
      // @ts-expect-error deliberately invalid kind for the adversarial test
      ops: [{ opId: "op-1", kind: "SHELL_EXEC", file: "src/pages/Cart.tsx", target: {}, params: {} }],
    });
    const violations = checkPolicy(proposal, baseCtx());
    expect(violations.some((v) => v.code === "E_OP_NOT_ALLOWED")).toBe(true);
  });

  it("P2: rejects a path traversal attempt", () => {
    const proposal = baseProposal({
      ops: [
        {
          opId: "op-1",
          kind: "REMOVE_JSX_ELEMENT",
          file: "../../etc/passwd",
          target: {},
          params: {},
        },
      ],
    });
    const violations = checkPolicy(proposal, baseCtx());
    expect(violations.some((v) => v.code === "E_PATH_NOT_ALLOWED")).toBe(true);
  });

  it("P2: rejects a file outside the scanned set", () => {
    const proposal = baseProposal({
      ops: [{ opId: "op-1", kind: "REMOVE_JSX_ELEMENT", file: "src/pages/NotScanned.tsx", target: {}, params: {} }],
    });
    const violations = checkPolicy(proposal, baseCtx());
    expect(violations.some((v) => v.code === "E_PATH_NOT_ALLOWED")).toBe(true);
  });

  it("P2: allows the FeeDisclosure.tsx exception even though it's not pre-scanned", () => {
    const proposal = baseProposal({
      ops: [
        {
          opId: "op-1",
          kind: "INSERT_FEE_DISCLOSURE",
          file: "src/components/FeeDisclosure.tsx",
          target: {},
          params: { stepIndex: 0, constKey: "handling", label: "Handling Fee" },
        },
      ],
    });
    const violations = checkPolicy(proposal, baseCtx());
    expect(violations.some((v) => v.code === "E_PATH_NOT_ALLOWED")).toBe(false);
  });

  it("P3: rejects a target fingerprint that does not belong to the finding", () => {
    const proposal = baseProposal({
      ops: [
        {
          opId: "op-1",
          kind: "REMOVE_JSX_ELEMENT",
          file: "src/pages/Cart.tsx",
          target: { fingerprint: "someone-elses-fingerprint" },
          params: {},
        },
      ],
    });
    const violations = checkPolicy(proposal, baseCtx());
    expect(violations.some((v) => v.code === "E_TARGET_MISMATCH")).toBe(true);
  });

  it("P4: rejects a disallowed CSS property", () => {
    const proposal = baseProposal({
      ops: [
        {
          opId: "op-1",
          kind: "SET_CSS_DECLARATION",
          file: "src/pages/Cart.tsx",
          target: { selector: ".decline" },
          params: { file: "src/styles.css", selector: ".decline", property: "position", value: "static" },
        },
      ],
    });
    const violations = checkPolicy(proposal, baseCtx());
    expect(violations.some((v) => v.code === "E_PROPERTY_NOT_ALLOWED")).toBe(true);
  });

  it("P6: rejects REPLACE_JSX_TEXT without a valid approval token", () => {
    const proposal = baseProposal({
      ops: [
        {
          opId: "op-1",
          kind: "REPLACE_JSX_TEXT",
          file: "src/pages/Cart.tsx",
          target: {},
          params: { from: "No thanks", to: "Skip this", approvalToken: "" },
        },
      ],
    });
    const violations = checkPolicy(proposal, baseCtx({ approvalTokenVerifier: () => false }));
    expect(violations.some((v) => v.code === "E_APPROVAL_REQUIRED")).toBe(true);
  });

  it("P6: rejects text that still matches the confirm-shaming filter", () => {
    const proposal = baseProposal({
      ops: [
        {
          opId: "op-1",
          kind: "REPLACE_JSX_TEXT",
          file: "src/pages/Cart.tsx",
          target: {},
          params: { from: "original", to: "No thanks, I don't want to save money", approvalToken: "tok" },
        },
      ],
    });
    const violations = checkPolicy(proposal, baseCtx());
    expect(violations.some((v) => v.code === "E_TEXT_NOT_ALLOWED")).toBe(true);
  });

  it("P6: rejects text that introduces a currency amount absent from the original", () => {
    const proposal = baseProposal({
      ops: [
        {
          opId: "op-1",
          kind: "REPLACE_JSX_TEXT",
          file: "src/pages/Cart.tsx",
          target: {},
          params: { from: "No thanks", to: "Pay ₹99 now", approvalToken: "tok" },
        },
      ],
    });
    const violations = checkPolicy(proposal, baseCtx());
    expect(violations.some((v) => v.code === "E_TEXT_NOT_ALLOWED")).toBe(true);
  });

  it("P7: rejects a proposal with more than 12 ops", () => {
    const ops = Array.from({ length: 13 }, (_, i) => ({
      opId: `op-${i}`,
      kind: "REMOVE_CSS_IMPORTANT" as const,
      file: "src/pages/Cart.tsx",
      target: {},
      params: { file: "src/styles.css", selector: ".decline", property: "opacity" },
    }));
    const violations = checkPolicy(baseProposal({ ops }), baseCtx());
    expect(violations.some((v) => v.code === "E_TOO_MANY_OPS")).toBe(true);
  });

  it("P9: rejects a proposal that has already been applied", () => {
    const proposal = baseProposal();
    const violations = checkPolicy(proposal, baseCtx({ appliedProposalIds: new Set([proposal.proposalId]) }));
    expect(violations.some((v) => v.code === "E_ALREADY_APPLIED")).toBe(true);
  });

  it("P10: rejects a finding that has exhausted its attempts", () => {
    const proposal = baseProposal();
    const violations = checkPolicy(
      proposal,
      baseCtx({ attemptsByFinding: new Map([[finding.findingId, 3]]), maxAttempts: 3 }),
    );
    expect(violations.some((v) => v.code === "E_ATTEMPTS_EXHAUSTED")).toBe(true);
  });

  it("allows a clean proposal through with no violations", () => {
    const violations = checkPolicy(baseProposal(), baseCtx());
    expect(violations).toEqual([]);
  });
});

describe("E_UNKNOWN_STRATEGY", () => {
  it("throws for an unregistered strategy id", async () => {
    const { config, model } = await setupFixture("f01-basket-simple", `test-unknown-${Date.now()}`);
    const location: SourceLocation = { file: "src/pages/Cart.tsx", startLine: 1, startColumn: 0, endLine: 1, endColumn: 1 };
    const finding = makeFinding({ ruleId: "PRM-001", pattern: "BASKET_SNEAKING", location, fingerprint: "x" });
    expect(() =>
      proposePatch({ finding, strategy: "not.a.real.strategy", params: {}, projectModel: model, config }),
    ).toThrowError(/E_UNKNOWN_STRATEGY|Unknown strategy/);
  });
});
