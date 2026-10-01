// Strategy registry — Spec Section 12.1.
// Turns {finding, strategy, params} into concrete PatchOp[]. Consumes the
// locked ProjectModel/parser output directly; never trusts strategy/params
// blindly (I-02) — every op is derived from the actual, currently-parsed
// source, not from caller-supplied claims about it.

import { randomUUID } from "node:crypto";
import type { Finding, PatchOp, PatchOpKind, SourceLocation } from "../types.js";
import type { PramaanConfig } from "../config.js";
import type { ComponentModel, JsxElementNode, ProjectModel } from "../parser/model.js";
import { resolveStyle, resolveBackgroundColor, type CascadeContext } from "../style/cascade.js";
import { contrastRatio } from "../style/contrast.js";
import { parseColor } from "../style/color.js";
import { err } from "../errors.js";

export interface StrategyInput {
  finding: Finding;
  strategy: string;
  params: Record<string, string | number | boolean>;
  projectModel: ProjectModel;
  config: PramaanConfig;
}

export interface StrategyOutput {
  ops: PatchOp[];
  risk: "deterministic" | "semantic";
}

function nextOpId(kind: PatchOpKind): string {
  return `op-${kind.toLowerCase()}-${randomUUID().slice(0, 8)}`;
}

// ---------- shared location lookup ----------

function pointLTE(aLine: number, aCol: number, bLine: number, bCol: number): boolean {
  return aLine < bLine || (aLine === bLine && aCol <= bCol);
}

function findExact(el: JsxElementNode, loc: SourceLocation): JsxElementNode | null {
  const r = el.range;
  if (r.startLine === loc.startLine && r.startColumn === loc.startColumn && r.endLine === loc.endLine && r.endColumn === loc.endColumn) {
    return el;
  }
  for (const c of el.children) {
    const found = findExact(c, loc);
    if (found) return found;
  }
  return null;
}

function findSmallestContaining(el: JsxElementNode, loc: SourceLocation): JsxElementNode | null {
  const withinStart = pointLTE(el.range.startLine, el.range.startColumn, loc.startLine, loc.startColumn);
  const withinEnd = pointLTE(loc.endLine, loc.endColumn, el.range.endLine, el.range.endColumn);
  if (!(withinStart && withinEnd)) return null;
  for (const c of el.children) {
    const found = findSmallestContaining(c, loc);
    if (found) return found;
  }
  return el;
}

function locateElement(
  input: StrategyInput,
): { element: JsxElementNode; component: ComponentModel; file: string } {
  const fileModel = input.projectModel.files.find((f) => f.path === input.finding.location.file);
  if (!fileModel) {
    throw err("E_TARGET_NOT_FOUND", `file ${input.finding.location.file} not found in project model`);
  }
  for (const c of fileModel.components) {
    if (!c.jsxRoot) continue;
    const exact = findExact(c.jsxRoot, input.finding.location);
    if (exact) return { element: exact, component: c, file: fileModel.path };
  }
  for (const c of fileModel.components) {
    if (!c.jsxRoot) continue;
    const contained = findSmallestContaining(c.jsxRoot, input.finding.location);
    if (contained) return { element: contained, component: c, file: fileModel.path };
  }
  throw err("E_TARGET_NOT_FOUND", `no JSX element found at finding location in ${fileModel.path}`);
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}

// ============================================================
// PRM-001 checkbox.default_off
// ============================================================

function buildCheckboxDefaultOff(input: StrategyInput): PatchOp[] {
  const { element, component, file } = locateElement(input);
  const checkedAttr = element.attributes.find((a) => a.name === "checked");

  let boundGetter: ComponentModel["useState"][number] | undefined;
  if (checkedAttr && !checkedAttr.isBare && checkedAttr.expressionSource) {
    const ident = checkedAttr.expressionSource.trim();
    boundGetter = component.useState.find((h) => h.getter === ident);
  }

  if (boundGetter && boundGetter.initialLiteral === true) {
    return [
      {
        opId: nextOpId("SET_INITIAL_STATE_LITERAL"),
        kind: "SET_INITIAL_STATE_LITERAL",
        file,
        target: { fingerprint: input.finding.fingerprint, line: boundGetter.range.startLine },
        params: { stateName: boundGetter.getter, from: true, to: false },
      },
    ];
  }

  const stateName = typeof input.params.stateName === "string" && input.params.stateName ? input.params.stateName : "checked";
  const setterName =
    typeof input.params.setterName === "string" && input.params.setterName
      ? input.params.setterName
      : `set${capitalize(stateName)}`;

  return [
    {
      opId: nextOpId("WIRE_CONTROLLED_CHECKBOX"),
      kind: "WIRE_CONTROLLED_CHECKBOX",
      file,
      target: { fingerprint: input.finding.fingerprint },
      params: { stateName, setterName },
    },
  ];
}

// ============================================================
// PRM-002 timer.remove_display
// ============================================================

function buildTimerRemoveDisplay(input: StrategyInput): PatchOp[] {
  const { file } = locateElement(input);
  return [
    {
      opId: nextOpId("REMOVE_JSX_ELEMENT"),
      kind: "REMOVE_JSX_ELEMENT",
      file,
      target: { fingerprint: input.finding.fingerprint },
      params: {},
    },
  ];
}

// ============================================================
// PRM-003 ii.normalize_reject_style
// ============================================================

const NORMALIZE_COLOR_CANDIDATES = ["#374151", "#111827", "#ffffff"];

interface FailingProperty {
  property: string;
  value: string;
}

function elementOwnClasses(el: JsxElementNode): string[] {
  const attr = el.attributes.find((a) => a.name === "className");
  return typeof attr?.literalValue === "string" ? attr.literalValue.split(/\s+/).filter(Boolean) : [];
}

function findAcceptFontPx(input: StrategyInput, ctx: CascadeContext, rejectEl: JsxElementNode): number {
  if (typeof input.params.acceptFontPx === "number") return input.params.acceptFontPx;
  const parent = rejectEl.parent;
  if (parent) {
    for (const sibling of parent.children) {
      if (sibling === rejectEl) continue;
      const classes = elementOwnClasses(sibling).join(" ");
      const text = sibling.textChildren.join(" ");
      if (/accept|cta-?yes|agree|confirm|yes\b/i.test(`${classes} ${text}`)) {
        const { result } = resolveStyle(sibling, ctx);
        const fontSize = result["font-size"];
        if (fontSize) {
          const px = parseFloat(fontSize.value);
          if (!Number.isNaN(px)) return px;
        }
      }
    }
  }
  return 16;
}

function computeFailingProperties(
  el: JsxElementNode,
  ctx: CascadeContext,
  acceptFontPx: number,
): FailingProperty[] {
  const { result } = resolveStyle(el, ctx);
  const failing: FailingProperty[] = [];

  const opacity = result.opacity ? parseFloat(result.opacity.value) : 1;
  if (!Number.isNaN(opacity) && opacity < 1) {
    failing.push({ property: "opacity", value: "1" });
  }

  const fontSizeEntry = result["font-size"];
  const targetFontPx = Math.max(14, Math.ceil(0.8 * acceptFontPx));
  if (fontSizeEntry) {
    const currentPx = parseFloat(fontSizeEntry.value);
    if (!Number.isNaN(currentPx) && currentPx < targetFontPx) {
      failing.push({ property: "font-size", value: `${targetFontPx}px` });
    }
  }

  const colorEntry = result.color;
  if (colorEntry) {
    const bg = resolveBackgroundColor(el, ctx);
    const fgColor = parseColor(colorEntry.value);
    const currentRatio = fgColor ? contrastRatio(fgColor, bg.color) : 0;
    if (currentRatio < 4.5) {
      for (const candidate of NORMALIZE_COLOR_CANDIDATES) {
        const parsed = parseColor(candidate);
        if (!parsed) continue;
        if (contrastRatio(parsed, bg.color) >= 4.5) {
          failing.push({ property: "color", value: candidate });
          break;
        }
      }
    }
  }

  const display = result.display?.value;
  if (display === "none") failing.push({ property: "display", value: "inline-block" });
  const visibility = result.visibility?.value;
  if (visibility === "hidden") failing.push({ property: "visibility", value: "visible" });
  for (const prop of ["width", "height"]) {
    const entry = result[prop];
    if (entry) {
      const px = parseFloat(entry.value);
      if (!Number.isNaN(px) && px === 0) failing.push({ property: prop, value: "auto" });
    }
  }
  for (const prop of ["left", "top"]) {
    const entry = result[prop];
    if (entry) {
      const px = parseFloat(entry.value);
      if (!Number.isNaN(px) && px <= -9999) failing.push({ property: prop, value: "auto" });
    }
  }

  return failing;
}

function buildNormalizeOwnRule(input: StrategyInput, el: JsxElementNode, failing: FailingProperty[]): PatchOp[] {
  const classes = elementOwnClasses(el);
  if (classes.length === 0) {
    throw err("E_TARGET_NOT_FOUND", "reject element has no class to match an own rule against");
  }
  let bestFile: string | undefined;
  let bestSelector: string | undefined;
  let bestLine = -1;
  let bestOrder = -1;
  let order = 0;
  for (const cssFile of input.projectModel.cssFiles) {
    for (const rule of cssFile.rules) {
      order++;
      if (rule.unsupportedAtRule) continue;
      const trimmed = rule.selector.trim();
      const isSingleClass = /^\.[A-Za-z0-9_-]+$/.test(trimmed);
      if (!isSingleClass) continue;
      const cls = trimmed.slice(1);
      if (!classes.includes(cls)) continue;
      const declaresFailing = rule.declarations.some((d) => failing.some((f) => f.property === d.property));
      if (!declaresFailing) continue;
      if (order > bestOrder) {
        bestOrder = order;
        bestFile = cssFile.path;
        bestSelector = trimmed;
        bestLine = rule.line;
      }
    }
  }
  if (!bestFile || !bestSelector) {
    throw err("E_TARGET_NOT_FOUND", "no own rule found for reject element; use scope: winning_rule or escalate", {
      classes,
    });
  }
  return failing.map((f) => ({
    opId: nextOpId("SET_CSS_DECLARATION"),
    kind: "SET_CSS_DECLARATION" as const,
    file: bestFile as string,
    target: { selector: bestSelector, line: bestLine },
    params: { file: bestFile as string, selector: bestSelector as string, property: f.property, value: f.value },
  }));
}

function buildNormalizeWinningRule(
  input: StrategyInput,
  el: JsxElementNode,
  ctx: CascadeContext,
  failing: FailingProperty[],
): PatchOp[] {
  const { result } = resolveStyle(el, ctx);
  const ops: PatchOp[] = [];
  for (const f of failing) {
    const winner = result[f.property]?.winnerEntry;
    if (!winner) {
      throw err("E_TARGET_NOT_FOUND", `no cascade winner found for property ${f.property}`);
    }
    ops.push({
      opId: nextOpId("SET_CSS_DECLARATION"),
      kind: "SET_CSS_DECLARATION",
      file: winner.file,
      target: { selector: winner.selector, line: winner.line },
      params: { file: winner.file, selector: winner.selector, property: f.property, value: f.value },
    });
    if (winner.important) {
      ops.push({
        opId: nextOpId("REMOVE_CSS_IMPORTANT"),
        kind: "REMOVE_CSS_IMPORTANT",
        file: winner.file,
        target: { selector: winner.selector, line: winner.line },
        params: { file: winner.file, selector: winner.selector, property: f.property },
      });
    }
  }
  return ops;
}

function buildNormalizeRejectStyle(input: StrategyInput): PatchOp[] {
  const { element, file } = locateElement(input);
  const ctx: CascadeContext = { projectModel: input.projectModel, config: input.config, filePath: file };
  const acceptFontPx = findAcceptFontPx(input, ctx, element);
  const failing = computeFailingProperties(element, ctx, acceptFontPx);
  if (failing.length === 0) {
    throw err("E_TARGET_NOT_FOUND", "no failing style properties found on reject element");
  }
  const scope = input.params.scope === "winning_rule" ? "winning_rule" : "own_rule";
  return scope === "own_rule" ? buildNormalizeOwnRule(input, element, failing) : buildNormalizeWinningRule(input, element, ctx, failing);
}

// ============================================================
// PRM-004 pricing.disclose_fee_early
// ============================================================

function extractFeeKeys(source: string): string[] {
  const match = /export\s+const\s+\w+\s*=\s*\{([^}]*)\}/.exec(source);
  if (!match) return [];
  const body = match[1] ?? "";
  const keys: string[] = [];
  const keyRe = /([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(body))) {
    keys.push(m[1] as string);
  }
  return keys;
}

function buildDiscloseFeeEarly(input: StrategyInput): PatchOp[] {
  const steps = input.config.checkoutFlow?.steps;
  if (!steps || steps.length === 0) {
    throw err("E_TARGET_NOT_FOUND", "checkoutFlow.steps[0] is not configured");
  }
  const stepFile = steps[0]?.file as string;
  const constKey = String(input.params.constKey ?? "");
  const label = String(input.params.label ?? "");
  if (!/^[a-zA-Z ]{3,40}$/.test(label)) {
    throw err("E_BAD_INPUT", "label must match ^[a-zA-Z ]{3,40}$", { label });
  }
  if (!input.config.feeConstants) {
    throw err("E_TARGET_NOT_FOUND", "config.feeConstants is not configured");
  }
  const feeFile = input.projectModel.files.find((f) => f.path === input.config.feeConstants);
  const keys = feeFile ? extractFeeKeys(feeFile.source) : [];
  if (!keys.includes(constKey)) {
    throw err("E_TARGET_NOT_FOUND", `fee constant "${constKey}" not found in ${input.config.feeConstants}`, {
      constKey,
    });
  }
  return [
    {
      opId: nextOpId("INSERT_FEE_DISCLOSURE"),
      kind: "INSERT_FEE_DISCLOSURE",
      file: stepFile,
      target: {},
      params: { stepIndex: 0, constKey, label },
    },
  ];
}

// ============================================================
// PRM-005 text.replace_neutral
// ============================================================

function buildReplaceNeutralText(input: StrategyInput): PatchOp[] {
  const { element, file } = locateElement(input);
  const from = element.textChildren.join(" ");
  const to = String(input.params.to ?? "");
  const approvalToken = String(input.params.approvalToken ?? "");
  if (!approvalToken) {
    throw err("E_APPROVAL_REQUIRED", "text.replace_neutral requires a human approval token");
  }
  if (!to) {
    throw err("E_TEXT_NOT_ALLOWED", "replacement text must not be empty");
  }
  return [
    {
      opId: nextOpId("REPLACE_JSX_TEXT"),
      kind: "REPLACE_JSX_TEXT",
      file,
      target: { fingerprint: input.finding.fingerprint },
      params: { from, to, approvalToken },
    },
  ];
}

// ============================================================
// dispatcher
// ============================================================

export function buildProposalOps(input: StrategyInput): StrategyOutput {
  switch (input.strategy) {
    case "checkbox.default_off":
      return { ops: buildCheckboxDefaultOff(input), risk: "deterministic" };
    case "timer.remove_display":
      return { ops: buildTimerRemoveDisplay(input), risk: "deterministic" };
    case "ii.normalize_reject_style":
      return { ops: buildNormalizeRejectStyle(input), risk: "deterministic" };
    case "pricing.disclose_fee_early":
      return { ops: buildDiscloseFeeEarly(input), risk: "deterministic" };
    case "text.replace_neutral":
      return { ops: buildReplaceNeutralText(input), risk: "semantic" };
    default:
      throw err("E_UNKNOWN_STRATEGY", `Unknown strategy: ${input.strategy}`);
  }
}
