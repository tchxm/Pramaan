// PRM-001 Basket Sneaking (AST) — Spec Section 10.1.
// Pure function (model, config) -> Finding[]. No I/O, no LLM.

import type { Finding } from "../types.js";
import type { ComponentModel, FileModel, JsxElementNode, ProjectModel } from "../parser/model.js";
import type { PramaanConfig } from "../config.js";
import { resolveLabel } from "../parser/label.js";
import { computeFingerprint } from "../fingerprint.js";
import { buildEvidence, findAttr, normalise, signal, type DetectorWarning } from "./util.js";

const CURRENCY_RE = /(₹|Rs\.?|INR|\$|USD|€)\s?\d/i;
const KEYWORD_RE = /protect|insurance|warranty|add-?on|donat|subscri|premium|gift ?wrap|priority|express|extended|membership|tip/i;
const EXCLUSION_RE = /terms|privacy|policy|remember me|keep me signed|stay logged|cookie|newsletter|agree/i;

interface DefaultSelected {
  fired: boolean;
  method: string | null;
}

function stateGetterInitialTrue(component: ComponentModel, identifier: string): boolean {
  const hook = component.useState.find((h) => h.getter === identifier);
  return hook?.initialLiteral === true;
}

function isCheckboxTarget(el: JsxElementNode, config: PramaanConfig): boolean {
  if (el.tag === "input") {
    const type = findAttr(el, "type");
    return type?.literalValue === "checkbox";
  }
  return config.checkboxComponents.includes(el.tag);
}

function determineDefaultSelected(el: JsxElementNode, component: ComponentModel): DefaultSelected {
  const checked = findAttr(el, "checked");
  const defaultChecked = findAttr(el, "defaultChecked");

  if (checked) {
    if (checked.isBare) return { fired: true, method: "checked_bare" };
    if (checked.literalValue === true) return { fired: true, method: "checked_literal_true" };
    if (
      checked.expressionSource &&
      /^[A-Za-z_$][\w$]*$/.test(checked.expressionSource) &&
      stateGetterInitialTrue(component, checked.expressionSource)
    ) {
      return { fired: true, method: "checked_state_getter_true" };
    }
  }
  if (defaultChecked) {
    if (defaultChecked.isBare) return { fired: true, method: "default_checked_bare" };
    if (defaultChecked.literalValue === true) return { fired: true, method: "default_checked_literal_true" };
    if (
      defaultChecked.expressionSource &&
      /^[A-Za-z_$][\w$]*$/.test(defaultChecked.expressionSource) &&
      stateGetterInitialTrue(component, defaultChecked.expressionSource)
    ) {
      return { fired: true, method: "default_checked_state_getter_true" };
    }
  }
  return { fired: false, method: null };
}

/** Adjacent sibling text within the same parent — used in addition to
 * resolveLabel()'s own text for the commercial-context regex check (spec
 * 10.1 says "in the label OR in an adjacent sibling text within the same
 * parent"). */
function siblingText(el: JsxElementNode): string {
  const parent = el.parent;
  if (!parent) return "";
  const idx = parent.children.indexOf(el);
  const parts: string[] = [...parent.textChildren];
  const next = idx >= 0 ? parent.children[idx + 1] : undefined;
  if (next) parts.push(...next.textChildren);
  return normalise(parts.join(" "));
}

export function basketSneaking(model: ProjectModel, config: PramaanConfig): Finding[] {
  const findings: Finding[] = [];

  for (const file of model.files) {
    for (const component of file.components) {
      if (!component.jsxRoot) continue;
      const root = component.jsxRoot;

      function walk(el: JsxElementNode): void {
        if (isCheckboxTarget(el, config)) {
          const defSel = determineDefaultSelected(el, component);
          if (defSel.fired) {
            const label = resolveLabel(el, root);
            if (label.text) {
              const combined = normalise(`${label.text} ${siblingText(el)}`);
              const currencyFired = CURRENCY_RE.test(combined);
              const keywordFired = KEYWORD_RE.test(combined);
              const excluded = EXCLUSION_RE.test(label.text);
              if (!excluded && (currencyFired || keywordFired)) {
                const fingerprint = computeFingerprint({
                  ruleId: "PRM-001",
                  file: file.path,
                  componentName: component.name,
                  jsxPath: el.jsxPath,
                  anchorText: label.text,
                });
                findings.push({
                  findingId: "",
                  ruleId: "PRM-001",
                  pattern: "BASKET_SNEAKING",
                  severity: "high",
                  status: "open",
                  detector: "AST",
                  location: {
                    file: file.path,
                    startLine: el.range.startLine,
                    startColumn: el.range.startColumn,
                    endLine: el.range.endLine,
                    endColumn: el.range.endColumn,
                  },
                  fingerprint,
                  title: "Checkbox pre-selected in a commercial context",
                  evidence: buildEvidence({
                    file,
                    range: el.range,
                    observed: {
                      label: label.text,
                      labelMethod: label.method,
                      defaultSelectedMethod: defSel.method,
                    },
                  }),
                  signals: [
                    signal("S_DEFAULT_SELECTED", true, 1, { method: defSel.method }),
                    signal("S_COMMERCIAL_CURRENCY", currencyFired, 0, { text: combined }),
                    signal("S_COMMERCIAL_KEYWORD", keywordFired, 0, { text: combined }),
                  ],
                  score: null,
                  requiresReview: false,
                  regulation: [],
                  attempts: 0,
                });
              }
            }
            // label.text === null -> LABEL_NOT_FOUND, handled by basketSneakingWarnings
          }
        }
        for (const c of el.children) walk(c);
      }
      walk(root);
    }
  }

  return findings;
}

export function basketSneakingWarnings(model: ProjectModel, config: PramaanConfig): DetectorWarning[] {
  const warnings: DetectorWarning[] = [];
  for (const file of model.files) {
    for (const component of file.components) {
      if (!component.jsxRoot) continue;
      const root = component.jsxRoot;
      function walk(el: JsxElementNode): void {
        if (isCheckboxTarget(el, config)) {
          const defSel = determineDefaultSelected(el, component);
          if (defSel.fired) {
            const label = resolveLabel(el, root);
            if (!label.text) {
              warnings.push({
                code: "LABEL_NOT_FOUND",
                message: `No label could be resolved for a pre-selected checkbox in ${file.path}:${el.range.startLine}`,
                file: file.path,
              });
            }
          }
        }
        for (const c of el.children) walk(c);
      }
      walk(root);
    }
  }
  return warnings;
}
