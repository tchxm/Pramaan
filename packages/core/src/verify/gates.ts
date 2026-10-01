// Verification engine — the ONLY source of verdicts (I-01). Spec Section 13.
// verifyFinding runs gates G1-G5 and returns a VerifyResult. No agent-
// provided text is read anywhere in this module — every input is a
// structural/DOM/build fact (Finding evidence is engine-produced, never
// agent text; PatchProposal.ops are engine-derived per I-02).

import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { stat } from "node:fs/promises";
import type {
  Finding,
  FailureReason,
  GateId,
  GateResult,
  PatchProposal,
  VerifyResult,
} from "../types.js";
import type { PramaanConfig } from "../config.js";
import type { Workspace } from "../workspace.js";
import type { ProjectModel, JsxElementNode } from "../parser/model.js";
import { buildProjectModel } from "../parser/project.js";
import { runDetectorsWithWarnings, type DetectorWarning } from "../detectors/index.js";
import { findPairs } from "../detectors/pairs.js";
import { normalise } from "../detectors/util.js";
import {
  computeSignals,
  isInterfaceInterferenceClear,
  type SideStyle,
} from "../detectors/interfaceInterference.js";
import { resolveStyle, resolveBackgroundColor, type CascadeContext } from "../style/cascade.js";
import { resolveLength, resolveFontWeight, resolveColorValue } from "../style/values.js";
import { resolveEffectiveContrast } from "../style/contrast.js";
import { computeFingerprint } from "../fingerprint.js";
import { computeProtectedManifest, type ProtectedElementEntry } from "../patch/policy.js";
import { runRuntimeGate } from "./runtime.js";

const exec = promisify(execCb);
const ENGINE_VERSION = "0.1.0";

export interface VerifyFindingInput {
  auditId: string;
  findingId: string;
  finding: Finding;
  workspace: Workspace;
  config: PramaanConfig;
  /** Protected manifest computed on the PRE-patch workspace (G2 baseline). */
  baselineManifest: ProtectedElementEntry[];
  /** Full detector scan (all rules) computed on the PRE-patch workspace (G5 baseline). */
  baselineFindings: Finding[];
  /** Detector warnings computed on the PRE-patch workspace (G5 baseline). */
  baselineWarnings: DetectorWarning[];
  /** The applied proposal for this finding, if any — needed to distinguish
   * CSS_OVERRIDE_WINS (a rule the proposal did NOT edit still wins) from a
   * plain DETECTOR_STILL_MATCHES (spec 13.1 G1 row). */
  appliedProposal?: PatchProposal;
}

// ============================================================
// G1 — Detector clear
// ============================================================

function styleNumber(result: ReturnType<typeof resolveStyle>["result"], prop: string): number | undefined {
  const entry = result[prop];
  if (!entry) return undefined;
  const resolved = resolveLength(entry.value);
  return resolved ? resolved.value : undefined;
}

/** Mirrors interfaceInterference.ts's private `resolveSide` (not exported).
 * Duplicated deliberately: G1's PRM-003 clear-rule check needs the same
 * SideStyle computation post-patch, and that helper is internal to
 * detectors/interfaceInterference.ts (out of scope to modify). See KNOWN
 * RISKS in the handoff for the rationale — same pattern patch/policy.ts
 * already uses for its own independent CONFIRM_SHAMING_PATTERNS copy. */
function resolveSideStyle(el: JsxElementNode, ctx: CascadeContext): { side: SideStyle; result: ReturnType<typeof resolveStyle>["result"] } {
  const { result } = resolveStyle(el, ctx);
  const rootVars: Record<string, string> = {};
  for (const cssFile of ctx.projectModel.cssFiles) Object.assign(rootVars, cssFile.rootVars);

  const fontPxResolved = styleNumber(result, "font-size");
  const fontPx = fontPxResolved ?? 16;
  const fontWeightRaw = result["font-weight"]?.value;
  const fontWeight = (fontWeightRaw !== undefined ? resolveFontWeight(fontWeightRaw) : null) ?? 400;
  const opacityRaw = result["opacity"]?.value;
  const opacity = opacityRaw !== undefined ? Number(opacityRaw) : 1;

  const colorRaw = result["color"]?.value;
  const fg = colorRaw !== undefined ? (resolveColorValue(colorRaw, rootVars)?.value ?? { r: 0, g: 0, b: 0, a: 1 }) : { r: 0, g: 0, b: 0, a: 1 };
  const bg = resolveBackgroundColor(el, ctx).color;
  const contrast = resolveEffectiveContrast(fg, bg, Number.isFinite(opacity) ? opacity : 1);

  const displayVal = result["display"]?.value;
  const visibilityVal = result["visibility"]?.value;
  const widthPx = styleNumber(result, "width");
  const heightPx = styleNumber(result, "height");
  const positionVal = result["position"]?.value;
  const leftPx = styleNumber(result, "left");
  const topPx = styleNumber(result, "top");

  const hidden =
    displayVal === "none" ||
    visibilityVal === "hidden" ||
    opacity === 0 ||
    fontPxResolved === 0 ||
    widthPx === 0 ||
    heightPx === 0 ||
    (positionVal === "absolute" && ((leftPx !== undefined && leftPx <= -999) || (topPx !== undefined && topPx <= -999)));

  return {
    side: { fontPx, fontWeight, contrast, opacity: Number.isFinite(opacity) ? opacity : 1, hidden },
    result,
  };
}

function proposalEditedRuleKeys(proposal: PatchProposal | undefined): Set<string> {
  const keys = new Set<string>();
  if (!proposal) return keys;
  for (const op of proposal.ops) {
    if (op.kind === "SET_CSS_DECLARATION" || op.kind === "REMOVE_CSS_IMPORTANT") {
      const file = typeof op.params.file === "string" ? op.params.file : op.file;
      const selector = typeof op.params.selector === "string" ? op.params.selector : op.target.selector;
      if (selector) keys.add(`${file}|${selector}`);
    }
  }
  return keys;
}

function firstFailingCssProperty(sig: ReturnType<typeof computeSignals>): string | null {
  if (sig.S3_OPACITY) return "opacity";
  if (sig.S1_CONTRAST_GAP) return "color";
  if (sig.S2_SIZE_RATIO) return "font-size";
  if (sig.H_HIDDEN) return "display";
  return null;
}

function gate1ForInterfaceInterference(
  model: ProjectModel,
  config: PramaanConfig,
  finding: Finding,
  appliedProposal: PatchProposal | undefined,
): GateResult {
  const file = model.files.find((f) => f.path === finding.location.file);
  if (!file) return { gate: "G1_DETECTOR_CLEAR", status: "pass", details: { reason: "FILE_NOT_FOUND_TREATED_AS_ABSENT" } };

  for (const component of file.components) {
    if (!component.jsxRoot) continue;
    const ctx: CascadeContext = { projectModel: model, config, filePath: file.path };
    for (const pair of findPairs(component.jsxRoot, config)) {
      const anchorText = normalise(`${pair.accept.text} / ${pair.reject.text}`);
      const fingerprint = computeFingerprint({
        ruleId: "PRM-003",
        file: file.path,
        componentName: component.name,
        jsxPath: pair.reject.el.jsxPath,
        anchorText,
      });
      if (fingerprint !== finding.fingerprint) continue;

      const { side: acceptSide } = resolveSideStyle(pair.accept.el, ctx);
      const { side: rejectSide, result: rejectResult } = resolveSideStyle(pair.reject.el, ctx);
      const sig = computeSignals(acceptSide, rejectSide);

      if (isInterfaceInterferenceClear(sig)) {
        return { gate: "G1_DETECTOR_CLEAR", status: "pass", details: { signals: sig } };
      }

      const property = firstFailingCssProperty(sig);
      const winner = property ? rejectResult[property]?.winnerEntry : undefined;
      const editedKeys = proposalEditedRuleKeys(appliedProposal);
      const winnerKey = winner ? `${winner.file}|${winner.selector}` : undefined;

      if (winner && winnerKey && !editedKeys.has(winnerKey)) {
        return {
          gate: "G1_DETECTOR_CLEAR",
          status: "fail",
          details: {
            code: "CSS_OVERRIDE_WINS",
            signals: sig,
            winner: { file: winner.file, selector: winner.selector, line: winner.line, important: winner.important, value: winner.value },
          },
        };
      }

      return { gate: "G1_DETECTOR_CLEAR", status: "fail", details: { code: "DETECTOR_STILL_MATCHES", signals: sig } };
    }
  }

  // Pair no longer locatable (structurally changed/removed) -> treat as
  // absent, i.e. clear, per the generic absence rule.
  return { gate: "G1_DETECTOR_CLEAR", status: "pass", details: { reason: "PAIR_NOT_RELOCATABLE" } };
}

export function gate1DetectorClear(
  model: ProjectModel,
  currentFindings: Finding[],
  config: PramaanConfig,
  finding: Finding,
  appliedProposal?: PatchProposal,
): GateResult {
  if (finding.ruleId === "PRM-003") {
    return gate1ForInterfaceInterference(model, config, finding, appliedProposal);
  }
  const stillPresent = currentFindings.some((f) => f.ruleId === finding.ruleId && f.fingerprint === finding.fingerprint);
  if (stillPresent) {
    return { gate: "G1_DETECTOR_CLEAR", status: "fail", details: { code: "DETECTOR_STILL_MATCHES" } };
  }
  return { gate: "G1_DETECTOR_CLEAR", status: "pass", details: {} };
}

// ============================================================
// G2 — Preservation
// ============================================================

export function gate2Preservation(
  model: ProjectModel,
  config: PramaanConfig,
  baselineManifest: ProtectedElementEntry[],
  finding: Finding,
  appliedProposal?: PatchProposal,
): GateResult {
  const current = computeProtectedManifest(model, config);
  const currentByFp = new Map(current.map((e) => [e.fingerprint, e]));

  const hasReplaceTextOp = (appliedProposal?.ops ?? []).some((op) => op.kind === "REPLACE_JSX_TEXT");
  const isFalseUrgencyRemoval = finding.pattern === "FALSE_URGENCY";

  const missing: { fingerprint: string; kind: string; normalisedText: string }[] = [];

  for (const baseline of baselineManifest) {
    const currentEntry = currentByFp.get(baseline.fingerprint);
    if (currentEntry && currentEntry.normalisedText === baseline.normalisedText) continue;

    // (a) the one element removed under the FALSE_URGENCY 12.3 exception.
    if (isFalseUrgencyRemoval && baseline.fingerprint === finding.fingerprint) continue;

    // (b) the one text changed under an approved REPLACE_JSX_TEXT — its
    // fingerprint necessarily changes (anchorText feeds the fingerprint),
    // so it legitimately disappears from the by-fingerprint diff.
    if (hasReplaceTextOp && baseline.fingerprint === finding.fingerprint) continue;

    if (currentEntry) continue; // present but text differs, and not an approved exception below

    missing.push(baseline);
  }

  if (missing.length > 0) {
    return { gate: "G2_PRESERVATION", status: "fail", details: { code: "PRESERVATION_BROKEN", missing } };
  }
  return { gate: "G2_PRESERVATION", status: "pass", details: {} };
}

// ============================================================
// G3 — Build
// ============================================================

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function tailLines(text: string, n: number): string[] {
  const lines = text.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - n));
}

export async function gate3Build(workspace: Workspace, config: PramaanConfig): Promise<GateResult> {
  const buildCommand = config.runtime.buildCommand || "npm run build";
  try {
    await exec(buildCommand, { cwd: workspace.root, timeout: 120_000, windowsHide: true });
  } catch (cause) {
    const out = (cause as { stdout?: string }).stdout ?? "";
    const errOut = (cause as { stderr?: string }).stderr ?? "";
    const combined = `${out}\n${errOut}`;
    return {
      gate: "G3_BUILD",
      status: "fail",
      details: { code: "BUILD_FAILED", step: "build", log: tailLines(combined, 40) },
    };
  }

  const tsconfigPath = path.join(workspace.root, "tsconfig.json");
  if (await fileExists(tsconfigPath)) {
    try {
      await exec("npx tsc --noEmit", { cwd: workspace.root, timeout: 120_000, windowsHide: true });
    } catch (cause) {
      const out = (cause as { stdout?: string }).stdout ?? "";
      const errOut = (cause as { stderr?: string }).stderr ?? "";
      const combined = `${out}\n${errOut}`;
      return {
        gate: "G3_BUILD",
        status: "fail",
        details: { code: "BUILD_FAILED", step: "tsc --noEmit", log: tailLines(combined, 40) },
      };
    }
  }

  return { gate: "G3_BUILD", status: "pass", details: {} };
}

// ============================================================
// G5 — No regression
// ============================================================

export function gate5NoRegression(
  currentFindings: Finding[],
  currentWarnings: DetectorWarning[],
  baselineFindings: Finding[],
  baselineWarnings: DetectorWarning[],
  appliedProposal?: PatchProposal,
): GateResult {
  const baselineFps = new Set(baselineFindings.map((f) => `${f.ruleId}|${f.fingerprint}`));
  const newFindings = currentFindings.filter((f) => !baselineFps.has(`${f.ruleId}|${f.fingerprint}`));

  const baselineParseErrors = new Set(
    baselineWarnings.filter((w) => w.code === "E_PARSE_ERROR").map((w) => `${w.file ?? ""}|${w.message}`),
  );
  const newParseErrors = currentWarnings.filter(
    (w) => w.code === "E_PARSE_ERROR" && !baselineParseErrors.has(`${w.file ?? ""}|${w.message}`),
  );

  const touchedFiles = new Set((appliedProposal?.ops ?? []).map((op) => op.file));
  const countUnsupportedByFile = (warnings: DetectorWarning[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const w of warnings) {
      if (!w.code.startsWith("UNSUPPORTED_")) continue;
      if (!w.file || !touchedFiles.has(w.file)) continue;
      m.set(w.file, (m.get(w.file) ?? 0) + 1);
    }
    return m;
  };
  const baselineUnsupported = countUnsupportedByFile(baselineWarnings);
  const currentUnsupported = countUnsupportedByFile(currentWarnings);
  const increasedFiles: string[] = [];
  for (const [file, count] of currentUnsupported) {
    if (count > (baselineUnsupported.get(file) ?? 0)) increasedFiles.push(file);
  }

  if (newFindings.length > 0 || newParseErrors.length > 0 || increasedFiles.length > 0) {
    return {
      gate: "G5_NO_REGRESSION",
      status: "fail",
      details: {
        code: "REGRESSION_INTRODUCED",
        newFindings: newFindings.map((f) => ({ ruleId: f.ruleId, fingerprint: f.fingerprint, file: f.location.file })),
        newParseErrors,
        increasedUnsupportedWarningFiles: increasedFiles,
      },
    };
  }
  return { gate: "G5_NO_REGRESSION", status: "pass", details: {} };
}

// ============================================================
// verifyFinding
// ============================================================

function verdictFromGates(gates: GateResult[]): "VERIFIED" | "STATIC_VERIFIED" | "FAILED" {
  const byId = new Map(gates.map((g) => [g.gate, g] as const));
  const staticGates: GateId[] = ["G1_DETECTOR_CLEAR", "G2_PRESERVATION", "G3_BUILD", "G5_NO_REGRESSION"];
  const staticPass = staticGates.every((id) => byId.get(id)?.status === "pass");
  const g4 = byId.get("G4_RUNTIME");

  if (staticPass && g4?.status === "pass") return "VERIFIED";
  if (staticPass && g4?.status === "not_run") return "STATIC_VERIFIED";
  return "FAILED";
}

function failureReasonFor(gate: GateResult): FailureReason | null {
  if (gate.status !== "fail") return null;
  const code = typeof gate.details.code === "string" ? gate.details.code : defaultFailureCode(gate.gate);
  return {
    code: code as FailureReason["code"],
    message: `${gate.gate} failed`,
    data: gate.details,
  };
}

function defaultFailureCode(gate: GateId): string {
  switch (gate) {
    case "G1_DETECTOR_CLEAR":
      return "DETECTOR_STILL_MATCHES";
    case "G2_PRESERVATION":
      return "PRESERVATION_BROKEN";
    case "G3_BUILD":
      return "BUILD_FAILED";
    case "G4_RUNTIME":
      return "RUNTIME_MISMATCH";
    case "G5_NO_REGRESSION":
      return "REGRESSION_INTRODUCED";
  }
}

/**
 * The ONLY source of verdicts (I-01). Runs gates G1-G5 and returns a
 * VerifyResult. No agent-provided text is read. Spec Section 13.
 *
 * NOTE: this is a signature change from the Phase 1 stub's
 * `(auditId, findingId)` — necessary because a real verdict needs the live
 * workspace, config, and pre-patch baselines to diff against. See the A5
 * handoff report for exactly what callers (A6 / CLI `verify.ts`) now need
 * to supply.
 */
export async function verifyFinding(input: VerifyFindingInput): Promise<VerifyResult> {
  const { finding, workspace, config, baselineManifest, baselineFindings, baselineWarnings, appliedProposal } = input;

  const model = await buildProjectModel(workspace.root, config);
  const { findings: currentFindings, warnings: currentWarnings } = runDetectorsWithWarnings({ model, config });

  const g1 = gate1DetectorClear(model, currentFindings, config, finding, appliedProposal);
  const g2 = gate2Preservation(model, config, baselineManifest, finding, appliedProposal);
  const g3 = await gate3Build(workspace, config);
  const g5 = gate5NoRegression(currentFindings, currentWarnings, baselineFindings, baselineWarnings, appliedProposal);

  const g4Map = await runRuntimeGate([finding], workspace, config);
  const g4 = g4Map.get(finding.findingId) ?? { gate: "G4_RUNTIME" as const, status: "fail" as const, details: { code: "E_INTERNAL", message: "G4 result missing" } };

  const gates: GateResult[] = [g1, g2, g3, g4, g5];
  const verdict = verdictFromGates(gates);
  const failureReasons: FailureReason[] = gates.map(failureReasonFor).filter((x): x is FailureReason => x !== null);

  return {
    findingId: finding.findingId,
    fingerprint: finding.fingerprint,
    verdict,
    gates,
    failureReasons,
    engineVersion: ENGINE_VERSION,
    verifiedAt: new Date().toISOString(),
  };
}
