// PRM-004 Drip Pricing (price flow) — Spec Section 10.4.
// Pure function (model, config) -> Finding[]. No I/O, no LLM (all inputs are
// already-loaded ProjectModel + PramaanConfig; config.feeConstants names a
// module whose SOURCE TEXT is already present on model.files — we scan it as
// plain text, we never execute it).

import type { Finding } from "../types.js";
import type { FileModel, ProjectModel } from "../parser/model.js";
import type { PramaanConfig } from "../config.js";
import { computeFingerprint } from "../fingerprint.js";
import { buildEvidence, signal, type DetectorWarning } from "./util.js";
import { parseFeeConstants, parseLocalNumericConsts } from "../pricing/extract.js";
import { allDisplayedAmounts, findFeeItems, hasAnyDisplayedPrice, type FeeItemObservation } from "../pricing/flow.js";

function findStepFile(model: ProjectModel, path: string): FileModel | undefined {
  return model.files.find((f) => f.path === path);
}

function resolveFeeConstants(model: ProjectModel, config: PramaanConfig): Record<string, number> {
  if (!config.feeConstants) return {};
  const file = findStepFile(model, config.feeConstants);
  if (!file) return {};
  return parseFeeConstants(file.source);
}

/** PRM-004 requires config.checkoutFlow.steps[]; when missing, the detector
 * does not run (spec 10.4: "If the flow config is missing the detector does
 * not run and the scan reports PRICE_FLOW_NOT_CONFIGURED — never a silent
 * pass. Convention fallback is NOT used."). See dripPricingWarnings for the
 * warning emission — see KNOWN RISKS for why this module exports a
 * `(model,config)=>Finding[]` / `(model,config)=>Warning[]` pair instead of
 * changing runDetectors' return shape. */
export function dripPricing(model: ProjectModel, config: PramaanConfig): Finding[] {
  if (!config.checkoutFlow || config.checkoutFlow.steps.length === 0) return [];

  const findings: Finding[] = [];
  const feeConstants = resolveFeeConstants(model, config);
  const steps = config.checkoutFlow.steps;
  const currencyTokens = config.currency;

  const stepFiles = steps.map((s) => ({ step: s, file: findStepFile(model, s.file) }));
  const lastEntry = stepFiles[stepFiles.length - 1];
  if (!lastEntry?.file) return [];
  const lastFile = lastEntry.file;
  const lastLocalConsts = parseLocalNumericConsts(lastFile.source);
  const lastFeeItems = findFeeItems(lastFile, lastLocalConsts, feeConstants, currencyTokens);

  for (const feeItem of lastFeeItems) {
    if (!feeItem.mandatory) continue;

    const keyword = feeItem.label.toLowerCase();
    let visibleEarlier = false;
    let earlierHasPrice = false;
    let firstVisibleStep = lastEntry.step.name;

    for (const { step, file } of stepFiles) {
      if (step === lastEntry.step) continue;
      if (!file) continue;
      if (new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(file.source)) {
        visibleEarlier = true;
        firstVisibleStep = step.name;
        break;
      }
      const localConsts = parseLocalNumericConsts(file.source);
      if (hasAnyDisplayedPrice(file, localConsts, feeConstants, currencyTokens)) {
        earlierHasPrice = true;
      }
    }

    if (visibleEarlier || !earlierHasPrice) continue;

    const initial = stepFiles[0]?.file
      ? allDisplayedAmounts(stepFiles[0].file, parseLocalNumericConsts(stepFiles[0].file.source), feeConstants, currencyTokens)[0]
      : undefined;
    const lastAmounts = allDisplayedAmounts(lastFile, lastLocalConsts, feeConstants, currencyTokens);
    const finalTotal = lastAmounts.length > 0 ? lastAmounts[lastAmounts.length - 1]?.amount : undefined;

    const anchorText = feeItem.label;
    const fingerprint = computeFingerprint({
      ruleId: "PRM-004",
      file: lastFile.path,
      componentName: lastFile.components.find((c) => c.jsxRoot)?.name ?? "<anonymous>",
      jsxPath: "fee-item",
      anchorText,
    });

    findings.push({
      findingId: "",
      ruleId: "PRM-004",
      pattern: "DRIP_PRICING",
      severity: "high",
      status: "open",
      detector: "PRICE_FLOW",
      location: {
        file: lastFile.path,
        startLine: feeItem.range.startLine,
        startColumn: feeItem.range.startColumn,
        endLine: feeItem.range.endLine,
        endColumn: feeItem.range.endColumn,
      },
      fingerprint,
      title: "Mandatory fee disclosed only at the last checkout step",
      evidence: buildEvidence({
        file: lastFile,
        range: feeItem.range,
        observed: {
          firstVisibleStep,
          initialDisplayedPrice: initial?.amount ?? null,
          finalTotal: finalTotal ?? null,
          undisclosedAmount: feeItem.amount,
          feeComponents: JSON.stringify(lastFeeItems.map((f) => ({ label: f.label, amount: f.amount, mandatory: f.mandatory }))),
        },
      }),
      signals: [signal("S_MANDATORY_FEE_UNDISCLOSED_EARLY", true, 1, { label: feeItem.label, amount: feeItem.amount })],
      score: null,
      requiresReview: false,
      regulation: [],
      attempts: 0,
    });
  }

  return findings;
}

export function dripPricingWarnings(model: ProjectModel, config: PramaanConfig): DetectorWarning[] {
  if (!config.checkoutFlow || config.checkoutFlow.steps.length === 0) {
    return [
      {
        code: "PRICE_FLOW_NOT_CONFIGURED",
        message: "config.checkoutFlow.steps[] is not configured; PRM-004 (drip pricing) was not run.",
      },
    ];
  }
  const missing: DetectorWarning[] = [];
  for (const step of config.checkoutFlow.steps) {
    if (!findStepFile(model, step.file)) {
      missing.push({
        code: "ROUTE_UNKNOWN",
        message: `checkoutFlow step "${step.name}" references file ${step.file} which was not found in the scanned project`,
        file: step.file,
      });
    }
  }
  return missing;
}
