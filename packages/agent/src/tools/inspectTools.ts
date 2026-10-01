// ast.inspect, css.cascade, price_flow.inspect — Spec 14.2 rows 4-6.
// Structured facts derived from the live ProjectModel. No raw file text is
// returned here beyond short normalised snippets already produced by core
// (these are NOT wrapped in untrusted_source because they are structured,
// engine-derived observations, not raw scanned text — consistent with how
// Finding.evidence itself is treated elsewhere in the engine).

import { z } from "zod";
import { ok, fail, zodIssues, resolveStyle, resolveBackgroundColor } from "@pramaan/core";
import type { Result, ProjectModel, JsxElementNode, SourceLocation, ComponentModel } from "@pramaan/core";
import type { CascadeContext } from "@pramaan/core";
import { extractLiteralAmounts, extractIdentifierAmounts, parseFeeConstants, parseLocalNumericConsts, findFeeItems, allDisplayedAmounts } from "@pramaan/core";
import type { AgentToolContext } from "./context.js";

// ---------- shared helpers ----------

function findElementByLocation(root: JsxElementNode, loc: SourceLocation): JsxElementNode | null {
  const r = root.range;
  if (
    r.startLine === loc.startLine &&
    r.startColumn === loc.startColumn &&
    r.endLine === loc.endLine &&
    r.endColumn === loc.endColumn
  ) {
    return root;
  }
  for (const c of root.children) {
    const found = findElementByLocation(c, loc);
    if (found) return found;
  }
  return null;
}

function locateFinding(
  model: ProjectModel,
  location: SourceLocation,
): { el: JsxElementNode; file: string; component: ComponentModel } | null {
  const file = model.files.find((f) => f.path === location.file);
  if (!file) return null;
  for (const component of file.components) {
    if (!component.jsxRoot) continue;
    const el = findElementByLocation(component.jsxRoot, location);
    if (el) return { el, file: file.path, component };
  }
  return null;
}

function elementText(el: JsxElementNode): string {
  const parts: string[] = [...el.textChildren];
  for (const c of el.children) parts.push(elementText(c));
  return parts.join(" ").trim();
}

function attrLiteral(el: JsxElementNode, name: string): string | number | boolean | null | undefined {
  return el.attributes.find((a) => a.name === name)?.literalValue;
}

// ---------- ast.inspect ----------

export const astInspectSchema = z.object({ path: z.string() });

export async function astInspectHandler(input: unknown, ctx: AgentToolContext): Promise<Result<unknown>> {
  const parsed = astInspectSchema.safeParse(input);
  if (!parsed.success) return fail("E_BAD_INPUT", "invalid input for ast.inspect", { issues: zodIssues(parsed.error) });

  const model = await ctx.getProjectModel();
  const file = model.files.find((f) => f.path === parsed.data.path);
  if (!file) return fail("E_NOT_FOUND", `file "${parsed.data.path}" not found in project model`);

  const components: { name: string; useState: number; useEffects: number }[] = [];
  const checkboxes: { component: string; jsxPath: string; tag: string; checked: unknown; defaultChecked: unknown; onChangeBound: boolean }[] = [];
  const timers: { component: string; hasIntervalOrTimeout: boolean }[] = [];
  const buttons: { component: string; jsxPath: string; tag: string; text: string }[] = [];
  const warnings: string[] = [];

  for (const component of file.components) {
    components.push({ name: component.name, useState: component.useState.length, useEffects: component.useEffects.length });
    for (const ue of component.useEffects) {
      if (ue.hasIntervalOrTimeout) timers.push({ component: component.name, hasIntervalOrTimeout: true });
    }
    if (!component.jsxRoot) continue;
    walkForAst(component.jsxRoot, component, ctx, checkboxes, buttons);
  }

  if (file.parseError) warnings.push(file.parseError.message);

  return ok({ components, checkboxes, timers, buttons, warnings });
}

function walkForAst(
  el: JsxElementNode,
  component: ComponentModel,
  ctx: AgentToolContext,
  checkboxes: { component: string; jsxPath: string; tag: string; checked: unknown; defaultChecked: unknown; onChangeBound: boolean }[],
  buttons: { component: string; jsxPath: string; tag: string; text: string }[],
): void {
  const tag = el.tag;
  const typeAttr = attrLiteral(el, "type");
  const isCheckboxLike = (tag === "input" && (typeAttr === "checkbox" || typeAttr === "radio")) || ctx.config.checkboxComponents.includes(el.tag);
  if (isCheckboxLike) {
    checkboxes.push({
      component: component.name,
      jsxPath: el.jsxPath,
      tag,
      checked: attrLiteral(el, "checked"),
      defaultChecked: attrLiteral(el, "defaultChecked"),
      onChangeBound: el.attributes.some((a) => a.name === "onChange"),
    });
  }
  if (tag === "button" || tag === "a" || ctx.config.buttonComponents.includes(el.tag)) {
    buttons.push({ component: component.name, jsxPath: el.jsxPath, tag, text: elementText(el) });
  }
  for (const c of el.children) walkForAst(c, component, ctx, checkboxes, buttons);
}

// ---------- css.cascade ----------

export const cssCascadeSchema = z.object({ fingerprint: z.string() });

export async function cssCascadeHandler(input: unknown, ctx: AgentToolContext): Promise<Result<unknown>> {
  const parsed = cssCascadeSchema.safeParse(input);
  if (!parsed.success) return fail("E_BAD_INPUT", "invalid input for css.cascade", { issues: zodIssues(parsed.error) });

  const finding = [...ctx.findings.values()].find((f) => f.fingerprint === parsed.data.fingerprint);
  if (!finding) return fail("E_NOT_FOUND", `no finding with fingerprint "${parsed.data.fingerprint}"`);

  const model = await ctx.getProjectModel();
  const located = locateFinding(model, finding.location);
  if (!located) {
    return ok({ element: null, resolved: {}, warnings: ["ELEMENT_NOT_RELOCATABLE"] });
  }

  const cascadeCtx: CascadeContext = { projectModel: model, config: ctx.config, filePath: located.file };
  const { result, warnings } = resolveStyle(located.el, cascadeCtx);
  const background = resolveBackgroundColor(located.el, cascadeCtx);

  const resolved: Record<string, { value: string; winner: unknown; contenders: unknown[] }> = {};
  for (const [prop, entry] of Object.entries(result)) {
    resolved[prop] = {
      value: entry.value,
      winner: entry.winnerEntry,
      contenders: entry.contenders,
    };
  }

  return ok({
    element: { file: located.file, jsxPath: located.el.jsxPath, tag: located.el.tag, text: elementText(located.el) },
    resolved,
    background: { color: background.color },
    warnings: [...warnings, ...background.warnings].map((w) => w.code),
  });
}

// ---------- price_flow.inspect ----------

export const priceFlowInspectSchema = z.object({});

export async function priceFlowInspectHandler(_input: unknown, ctx: AgentToolContext): Promise<Result<unknown>> {
  const flow = ctx.config.checkoutFlow;
  if (!flow || flow.steps.length === 0) {
    return fail("E_BAD_INPUT", "no checkoutFlow configured for this project (PRICE_FLOW_NOT_CONFIGURED)");
  }

  const model = await ctx.getProjectModel();
  const currency = ctx.config.currency;

  let feeConstants: Record<string, number> = {};
  if (ctx.config.feeConstants) {
    const feeFile = model.files.find((f) => f.path === ctx.config.feeConstants);
    if (feeFile) feeConstants = parseFeeConstants(feeFile.source);
  }

  const steps: { index: number; name: string; file: string; amounts: unknown[]; fees: unknown[] }[] = [];
  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i] as { name: string; file: string; route: string };
    const file = model.files.find((f) => f.path === step.file);
    if (!file) {
      steps.push({ index: i, name: step.name, file: step.file, amounts: [], fees: [] });
      continue;
    }
    const localConsts = parseLocalNumericConsts(file.source);
    const amounts = allDisplayedAmounts(file, localConsts, feeConstants, currency);
    const fees = findFeeItems(file, localConsts, feeConstants, currency);
    steps.push({
      index: i,
      name: step.name,
      file: step.file,
      amounts: amounts.map((a) => ({ value: a.amount, text: a.raw })),
      fees: fees.map((f) => ({ label: f.label, amount: f.amount, mandatory: f.mandatory })),
    });
  }

  const totals = {
    firstStepTotal: steps[0]?.amounts[0] ?? null,
    lastStepTotal: steps.at(-1)?.amounts.at(-1) ?? null,
    feeCountIntroducedLate: steps.slice(1).reduce((n, s) => n + s.fees.length, 0),
  };

  return ok({ steps, totals });
}
