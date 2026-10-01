// PRM-003 Interface Interference (CSS cascade, "potential") — Spec 10.3.
// Pure function (model, config) -> Finding[]. No I/O, no LLM.

import type { CascadeEntry, Finding, Signal } from "../types.js";
import type { JsxElementNode, ProjectModel } from "../parser/model.js";
import type { PramaanConfig } from "../config.js";
import { resolveStyle, resolveBackgroundColor, type CascadeContext, type ResolvedStyle } from "../style/cascade.js";
import { resolveLength, resolveFontWeight, resolveColorValue } from "../style/values.js";
import { resolveEffectiveContrast } from "../style/contrast.js";
import { computeFingerprint } from "../fingerprint.js";
import { buildEvidence, normalise, signal as mkSignal, type DetectorWarning } from "./util.js";
import { findPairs, type AcceptRejectPair } from "./pairs.js";

export interface SideStyle {
  fontPx: number;
  fontWeight: number;
  contrast: number;
  opacity: number;
  hidden: boolean;
}

function styleNumber(result: ResolvedStyle, prop: string): number | undefined {
  const entry = result[prop];
  if (!entry) return undefined;
  const resolved = resolveLength(entry.value);
  return resolved ? resolved.value : undefined;
}

function resolveSide(el: JsxElementNode, ctx: CascadeContext): { side: SideStyle; result: ResolvedStyle } {
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
  const fg = colorRaw !== undefined ? resolveColorValue(colorRaw, rootVars)?.value ?? { r: 0, g: 0, b: 0, a: 1 } : { r: 0, g: 0, b: 0, a: 1 };
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

export interface PairSignals {
  S1_CONTRAST_GAP: boolean;
  S2_SIZE_RATIO: boolean;
  S3_OPACITY: boolean;
  S4_WEIGHT_GAP: boolean;
  S5_LOW_ABSOLUTE_SIZE: boolean;
  H_HIDDEN: boolean;
}

export function computeSignals(accept: SideStyle, reject: SideStyle): PairSignals {
  return {
    S1_CONTRAST_GAP: reject.contrast < 4.5 && accept.contrast >= 4.5,
    S2_SIZE_RATIO: accept.fontPx > 0 && reject.fontPx / accept.fontPx < 0.6,
    S3_OPACITY: reject.opacity <= 0.6 && accept.opacity >= 0.9,
    S4_WEIGHT_GAP: accept.fontWeight >= 600 && reject.fontWeight <= 400,
    S5_LOW_ABSOLUTE_SIZE: reject.fontPx < 12,
    H_HIDDEN: reject.hidden === true,
  };
}

const WEIGHTS: Record<keyof Omit<PairSignals, "H_HIDDEN">, number> = {
  S1_CONTRAST_GAP: 0.3,
  S2_SIZE_RATIO: 0.25,
  S3_OPACITY: 0.25,
  S4_WEIGHT_GAP: 0.1,
  S5_LOW_ABSOLUTE_SIZE: 0.1,
};

export function computeScore(sig: PairSignals): number {
  if (sig.H_HIDDEN) return 1;
  let sum = 0;
  for (const key of Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]) {
    if (sig[key]) sum += WEIGHTS[key];
  }
  return Math.min(1, sum);
}

export function isFlagged(sig: PairSignals, score: number): boolean {
  if (sig.H_HIDDEN) return true;
  const firedCount = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).filter((k) => sig[k]).length;
  return score >= 0.5 && firedCount >= 2;
}

/** Clear rule (verification mode, spec 10.3): a pair is clear only when S1,
 * S2, S3 and H_HIDDEN all evaluate false (S4/S5 informational). Exported
 * for the verification engineer's G1 gate. */
export function isInterfaceInterferenceClear(sig: PairSignals): boolean {
  return !sig.S1_CONTRAST_GAP && !sig.S2_SIZE_RATIO && !sig.S3_OPACITY && !sig.H_HIDDEN;
}

function toSignalList(sig: PairSignals, score: number, accept: SideStyle, reject: SideStyle): Signal[] {
  return [
    mkSignal("S1_CONTRAST_GAP", sig.S1_CONTRAST_GAP, 0.3, { acceptContrast: accept.contrast, rejectContrast: reject.contrast }),
    mkSignal("S2_SIZE_RATIO", sig.S2_SIZE_RATIO, 0.25, { acceptFontPx: accept.fontPx, rejectFontPx: reject.fontPx }),
    mkSignal("S3_OPACITY", sig.S3_OPACITY, 0.25, { acceptOpacity: accept.opacity, rejectOpacity: reject.opacity }),
    mkSignal("S4_WEIGHT_GAP", sig.S4_WEIGHT_GAP, 0.1, { acceptWeight: accept.fontWeight, rejectWeight: reject.fontWeight }),
    mkSignal("S5_LOW_ABSOLUTE_SIZE", sig.S5_LOW_ABSOLUTE_SIZE, 0.1, { rejectFontPx: reject.fontPx }),
    mkSignal("H_HIDDEN", sig.H_HIDDEN, sig.H_HIDDEN ? 1 : 0, { hidden: reject.hidden, scoreOverride: sig.H_HIDDEN ? score : null }),
  ];
}

function cascadeFor(result: ResolvedStyle, props: string[]): CascadeEntry[] {
  const out: CascadeEntry[] = [];
  for (const p of props) {
    const entry = result[p];
    if (entry) out.push(...entry.contenders);
  }
  return out;
}

export function interfaceInterference(model: ProjectModel, config: PramaanConfig): Finding[] {
  const findings: Finding[] = [];

  for (const file of model.files) {
    for (const component of file.components) {
      if (!component.jsxRoot) continue;
      const ctx: CascadeContext = { projectModel: model, config, filePath: file.path };
      const pairs: AcceptRejectPair[] = findPairs(component.jsxRoot, config);

      for (const pair of pairs) {
        const { side: acceptSide, result: acceptResult } = resolveSide(pair.accept.el, ctx);
        const { side: rejectSide, result: rejectResult } = resolveSide(pair.reject.el, ctx);

        const sig = computeSignals(acceptSide, rejectSide);
        const score = computeScore(sig);
        if (!isFlagged(sig, score)) continue;

        const severity = sig.H_HIDDEN || score >= 0.75 ? "high" : "medium";
        const anchorText = normalise(`${pair.accept.text} / ${pair.reject.text}`);
        const fingerprint = computeFingerprint({
          ruleId: "PRM-003",
          file: file.path,
          componentName: component.name,
          jsxPath: pair.reject.el.jsxPath,
          anchorText,
        });

        findings.push({
          findingId: "",
          ruleId: "PRM-003",
          pattern: "INTERFACE_INTERFERENCE",
          severity,
          status: "open",
          detector: "CSS_CASCADE",
          location: {
            file: file.path,
            startLine: pair.reject.el.range.startLine,
            startColumn: pair.reject.el.range.startColumn,
            endLine: pair.reject.el.range.endLine,
            endColumn: pair.reject.el.range.endColumn,
          },
          fingerprint,
          title: "Potential interface interference",
          evidence: buildEvidence({
            file,
            range: pair.reject.el.range,
            observed: {
              acceptText: pair.accept.text,
              rejectText: pair.reject.text,
              score,
              accept: JSON.stringify(acceptSide),
              reject: JSON.stringify(rejectSide),
            },
            cascade: [
              ...cascadeFor(rejectResult, ["color", "opacity", "font-size", "font-weight", "background", "background-color", "display", "visibility"]),
              ...cascadeFor(acceptResult, ["color", "opacity", "font-size", "font-weight", "background", "background-color"]),
            ],
          }),
          signals: toSignalList(sig, score, acceptSide, rejectSide),
          score,
          requiresReview: true,
          regulation: [],
          attempts: 0,
        });
      }
    }
  }

  return findings;
}

export function interfaceInterferenceWarnings(model: ProjectModel, config: PramaanConfig): DetectorWarning[] {
  const warnings: DetectorWarning[] = [];
  for (const file of model.files) {
    for (const component of file.components) {
      if (!component.jsxRoot) continue;
      const ctx: CascadeContext = { projectModel: model, config, filePath: file.path };
      for (const pair of findPairs(component.jsxRoot, config)) {
        const { warnings: w1 } = resolveStyle(pair.accept.el, ctx);
        const { warnings: w2 } = resolveStyle(pair.reject.el, ctx);
        for (const w of [...w1, ...w2]) {
          warnings.push({ code: w.code, message: w.message, file: file.path });
        }
      }
    }
  }
  return warnings;
}
