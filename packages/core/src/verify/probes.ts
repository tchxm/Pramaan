// Runtime probes — Spec Section 13.2. One function per pattern, dispatched
// by `runProbe`. Reads only structural/DOM facts derived from the finding's
// evidence (I-01: no agent-provided free text influences a gate result —
// evidence here is engine-produced, not agent-produced).

import type { Page } from "playwright";
import type { Finding, PatternId } from "../types.js";
import type { PramaanConfig } from "../config.js";

export interface ProbeResult {
  pass: boolean;
  observed: Record<string, unknown>;
  reason?: string;
}

/** Route resolution shared by all probes (spec 13.2 final paragraph):
 * checkoutFlow.steps[] match by file, else config.runtime.routes[file].
 * Returns null when no route can be resolved -> caller must fail the gate
 * with ROUTE_UNKNOWN, never silently skip (I-08/I-12). */
export function resolveRoute(file: string, config: PramaanConfig): string | null {
  const step = config.checkoutFlow?.steps.find((s) => s.file === file);
  if (step) return step.route;
  const route = config.runtime.routes?.[file];
  return route ?? null;
}

function stepZeroRoute(config: PramaanConfig): string | null {
  const step0 = config.checkoutFlow?.steps[0];
  if (step0) return step0.route;
  return null;
}

async function gotoRoute(page: Page, baseUrl: string, route: string): Promise<void> {
  const url = new URL(route, baseUrl).toString();
  await page.goto(url, { waitUntil: "load" });
}

// ---------- PRM-001 ----------

async function probeBasketSneaking(page: Page, baseUrl: string, finding: Finding, config: PramaanConfig): Promise<ProbeResult> {
  const route = resolveRoute(finding.location.file, config);
  if (!route) return { pass: false, observed: {}, reason: "ROUTE_UNKNOWN" };
  await gotoRoute(page, baseUrl, route);

  const labelText = String(finding.evidence.observed.label ?? "");
  if (!labelText) return { pass: false, observed: {}, reason: "NO_LABEL_TEXT" };

  const locator = page.getByLabel(labelText, { exact: false }).first();
  const count = await locator.count();
  if (count === 0) {
    // Fallback: find a checkbox whose nearby text contains the label.
    const fallback = page.locator(`text=${labelText}`).locator("xpath=//input[@type='checkbox']").first();
    const fbCount = await fallback.count().catch(() => 0);
    if (fbCount === 0) {
      return { pass: false, observed: { labelText }, reason: "CHECKBOX_NOT_FOUND" };
    }
    const checked = await fallback.isChecked();
    return { pass: checked === false, observed: { labelText, checked } };
  }

  const checked = await locator.isChecked();
  return { pass: checked === false, observed: { labelText, checked } };
}

// ---------- PRM-002 ----------

async function probeFalseUrgency(page: Page, baseUrl: string, finding: Finding, config: PramaanConfig): Promise<ProbeResult> {
  const route = resolveRoute(finding.location.file, config);
  if (!route) return { pass: false, observed: {}, reason: "ROUTE_UNKNOWN" };
  await gotoRoute(page, baseUrl, route);

  const urgencyText = String(finding.evidence.observed.urgencyText ?? "");
  if (!urgencyText) return { pass: false, observed: {}, reason: "NO_URGENCY_TEXT" };

  async function countMatches(): Promise<number> {
    return page.getByText(urgencyText, { exact: false }).count();
  }

  const first = await countMatches();
  await page.waitForTimeout(2500);
  const second = await countMatches();

  const pass = first === 0 && second === 0;
  return { pass, observed: { urgencyText, countAtLoad: first, countAfterWait: second } };
}

// ---------- PRM-003 ----------

interface InPageStyle {
  fontSize: number;
  effectiveOpacity: number;
  color: string;
  effectiveBackground: string;
  visibility: string;
  display: string;
  width: number;
  height: number;
}

/** Runs in-page (serialized by Playwright via Function.toString()) — must
 * be a self-contained function with no references to the enclosing Node
 * closure. Computes effective (compounded) opacity by walking ancestors,
 * and the nearest non-transparent ancestor background, which is a more
 * accurate real-DOM signal than the static cascade engine's per-element
 * resolution (see KNOWN RISKS: this is intentional — catching exactly this
 * kind of static/runtime divergence is what G4 is for). */
function effectiveStyleInPage(el: HTMLElement): InPageStyle {
  function effectiveOpacity(node: HTMLElement | null): number {
    let op = 1;
    let cur: HTMLElement | null = node;
    while (cur) {
      const cs = window.getComputedStyle(cur);
      const o = parseFloat(cs.opacity);
      if (!Number.isNaN(o)) op *= o;
      cur = cur.parentElement;
    }
    return op;
  }
  function effectiveBackground(node: HTMLElement | null): string {
    let cur: HTMLElement | null = node;
    while (cur) {
      const cs = window.getComputedStyle(cur);
      const bg = cs.backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
      cur = cur.parentElement;
    }
    return "rgb(255, 255, 255)";
  }
  const cs = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return {
    fontSize: parseFloat(cs.fontSize),
    effectiveOpacity: effectiveOpacity(el),
    color: cs.color,
    effectiveBackground: effectiveBackground(el),
    visibility: cs.visibility,
    display: cs.display,
    width: rect.width,
    height: rect.height,
  };
}

function parseCssColor(raw: string): { r: number; g: number; b: number; a: number } | null {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(raw);
  if (!m) return null;
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] !== undefined ? Number(m[4]) : 1,
  };
}

function toLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(r: number, g: number, b: number): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}
function contrastRatio(fg: { r: number; g: number; b: number }, bg: { r: number; g: number; b: number }): number {
  const lFg = luminance(fg.r, fg.g, fg.b);
  const lBg = luminance(bg.r, bg.g, bg.b);
  return (Math.max(lFg, lBg) + 0.05) / (Math.min(lFg, lBg) + 0.05);
}

async function probeInterfaceInterference(page: Page, baseUrl: string, finding: Finding, config: PramaanConfig): Promise<ProbeResult> {
  const route = resolveRoute(finding.location.file, config);
  if (!route) return { pass: false, observed: {}, reason: "ROUTE_UNKNOWN" };
  await gotoRoute(page, baseUrl, route);
  // Let any post-mount effects (e.g. a runtime-only ref.style mutation,
  // spec 19.8 F08e) settle before reading computed styles — a static patch
  // can be correct at parse time yet still be undone by JS shortly after
  // mount, which is exactly the blind spot G4 exists to catch.
  await page.waitForTimeout(300);

  const acceptText = String(finding.evidence.observed.acceptText ?? "");
  const rejectText = String(finding.evidence.observed.rejectText ?? "");
  if (!acceptText || !rejectText) return { pass: false, observed: {}, reason: "NO_PAIR_TEXT" };

  const rejectLocator = page.getByText(rejectText, { exact: true }).first();
  const acceptLocator = page.getByText(acceptText, { exact: true }).first();
  const rejectCount = await rejectLocator.count();
  const acceptCount = await acceptLocator.count();
  if (rejectCount === 0 || acceptCount === 0) {
    return { pass: false, observed: { acceptText, rejectText }, reason: "ELEMENTS_NOT_FOUND" };
  }

  const rejectStyle = await rejectLocator.evaluate(effectiveStyleInPage);
  const acceptStyle = await acceptLocator.evaluate(effectiveStyleInPage);

  const fg = parseCssColor(rejectStyle.color);
  const bg = parseCssColor(rejectStyle.effectiveBackground);
  const contrast = fg && bg ? contrastRatio(fg, bg) : 0;

  const visible = rejectStyle.visibility !== "hidden" && rejectStyle.display !== "none";
  const hasSize = rejectStyle.width > 0 && rejectStyle.height > 0;
  const fontOk = rejectStyle.fontSize >= 14;
  const opacityOk = rejectStyle.effectiveOpacity >= 0.9;
  const contrastOk = contrast >= 4.5;
  const ratioOk = acceptStyle.fontSize > 0 && rejectStyle.fontSize / acceptStyle.fontSize >= 0.75;

  const pass = visible && hasSize && fontOk && opacityOk && contrastOk && ratioOk;

  return {
    pass,
    observed: {
      acceptText,
      rejectText,
      reject: rejectStyle,
      accept: acceptStyle,
      contrast,
      checks: { visible, hasSize, fontOk, opacityOk, contrastOk, ratioOk },
    },
  };
}

// ---------- PRM-004 ----------

async function probeDripPricing(page: Page, baseUrl: string, finding: Finding, config: PramaanConfig): Promise<ProbeResult> {
  const route = stepZeroRoute(config) ?? resolveRoute(finding.location.file, config);
  if (!route) return { pass: false, observed: {}, reason: "ROUTE_UNKNOWN" };
  await gotoRoute(page, baseUrl, route);

  const observed = finding.evidence.observed;
  let label = "";
  const feeComponentsRaw = observed.feeComponents;
  if (typeof feeComponentsRaw === "string") {
    try {
      const parsed = JSON.parse(feeComponentsRaw) as { label: string; amount: number }[];
      label = parsed[0]?.label ?? "";
    } catch {
      // ignore
    }
  }
  const amount = observed.undisclosedAmount;

  const bodyText = (await page.locator("body").innerText()).toLowerCase();
  const labelPresent = label ? bodyText.includes(label.toLowerCase()) : false;
  const amountPresent = amount !== null && amount !== undefined ? bodyText.includes(String(amount)) : false;

  const pass = labelPresent && amountPresent;
  return { pass, observed: { label, amount, labelPresent, amountPresent } };
}

// ---------- PRM-005 ----------

async function probeConfirmShaming(page: Page, baseUrl: string, finding: Finding, config: PramaanConfig): Promise<ProbeResult> {
  const route = resolveRoute(finding.location.file, config);
  if (!route) return { pass: false, observed: {}, reason: "ROUTE_UNKNOWN" };
  await gotoRoute(page, baseUrl, route);

  const observed = finding.evidence.observed;
  const originalText = String(observed.originalText ?? observed.from ?? "");
  const replacementText = String(observed.replacementText ?? observed.to ?? "");
  if (!replacementText) return { pass: false, observed: {}, reason: "NO_REPLACEMENT_TEXT" };

  const replacementCount = await page.getByText(replacementText, { exact: false }).count();
  const originalCount = originalText ? await page.getByText(originalText, { exact: true }).count() : 0;

  const pass = replacementCount > 0 && originalCount === 0;
  return { pass, observed: { originalText, replacementText, replacementCount, originalCount } };
}

// ---------- dispatcher ----------

export async function runProbe(
  pattern: PatternId,
  page: Page,
  baseUrl: string,
  finding: Finding,
  config: PramaanConfig,
): Promise<ProbeResult> {
  switch (pattern) {
    case "BASKET_SNEAKING":
      return probeBasketSneaking(page, baseUrl, finding, config);
    case "FALSE_URGENCY":
      return probeFalseUrgency(page, baseUrl, finding, config);
    case "INTERFACE_INTERFERENCE":
      return probeInterfaceInterference(page, baseUrl, finding, config);
    case "DRIP_PRICING":
      return probeDripPricing(page, baseUrl, finding, config);
    case "CONFIRM_SHAMING":
      return probeConfirmShaming(page, baseUrl, finding, config);
    default:
      return { pass: false, observed: {}, reason: "UNKNOWN_PATTERN" };
  }
}
