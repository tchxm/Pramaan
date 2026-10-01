// Detector orchestrator — Spec Section 10 (preamble) + Section 11.
//
// `runDetectors` keeps its EXISTING synchronous `(ctx) => Finding[]`
// signature (packages/cli/src/commands/scan.ts already calls it
// synchronously and is out of scope to change — see KNOWN RISKS in the
// handoff report for the full rationale). Because of that, regulation
// lookup — which the locked `regulation/index.ts` exposes only as an
// async `lookupRegulation()` reading a bundled JSON file — is re-read here
// SYNCHRONOUSLY via `node:fs`'s readFileSync against the same
// `regulation/data/india.json` bundled file, once per `runDetectors` call,
// mirroring `lookupRegulation`'s own data shape exactly. This is the "pre-
// resolve all 5 patterns' RegulationRef[] once up front" step described in
// the task brief, done synchronously instead of via `await
// Promise.all(...)` so the public `runDetectors` signature does not change.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Finding, PatternId, RegulationRef } from "../types.js";
import type { ProjectModel } from "../parser/model.js";
import type { PramaanConfig } from "../config.js";
import { basketSneaking, basketSneakingWarnings } from "./basketSneaking.js";
import { falseUrgency, falseUrgencyWarnings } from "./falseUrgency.js";
import { interfaceInterference, interfaceInterferenceWarnings } from "./interfaceInterference.js";
import { dripPricing, dripPricingWarnings } from "./dripPricing.js";
import { locationSortKey, type DetectorWarning } from "./util.js";

export interface DetectorContext {
  model: ProjectModel;
  config: PramaanConfig;
}

export type { DetectorWarning } from "./util.js";

// ---------- synchronous regulation preload (see file header) ----------

interface IndiaRegulationData {
  regulationDataVersion: string;
  auditDuty: string;
  patterns: Record<
    string,
    { patternName: string; framework: string; plainBasis: string; verifiedAgainstGazette: boolean }
  >;
}

let regulationCache: IndiaRegulationData | null = null;

function loadRegulationDataSync(): IndiaRegulationData {
  if (regulationCache) return regulationCache;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(path.join(here, "..", "regulation", "data", "india.json"), "utf-8");
  regulationCache = JSON.parse(raw) as IndiaRegulationData;
  return regulationCache;
}

function regulationRefsFor(pattern: PatternId): RegulationRef[] {
  const data = loadRegulationDataSync();
  const entry = data.patterns[pattern];
  if (!entry) return [];
  return [
    {
      jurisdiction: "IN",
      framework: entry.framework,
      patternName: entry.patternName,
      auditDuty: data.auditDuty,
      plainBasis: entry.plainBasis,
      verifiedAgainstGazette: entry.verifiedAgainstGazette,
    },
  ];
}

// ---------- orchestration ----------

/**
 * Runs the four statically-derivable PRAMAAN detectors (PRM-001..004) and
 * returns a unified, deterministically ordered Finding[] (by file path,
 * then line, then column — spec Section 10 preamble), with `findingId`
 * assigned per-rule ("F-PRM-001-1", spec 8), `regulation[]` attached (spec
 * 11), and `attempts: 0` / `status: "open"` set on every finding.
 *
 * PRM-005 (Confirm Shaming) is intentionally NOT included here: per spec
 * 10.5 item 3, "a finding exists only if step 1 matched and `likely` is
 * true", and `likely` only ever comes from the agent package's LLM-backed
 * `semantic.inspect` tool, which core cannot call (I-09: core/detectors
 * never invent findings from LLM output). Use
 * `findConfirmShamingCandidates(model, config)` from
 * `./confirmShamingCandidate.js` to get the deterministic step-1 candidates;
 * the agent engineer promotes `likely:true` candidates to real Findings.
 *
 * Pure function: no I/O, no LLM. (The synchronous regulation-data read
 * above is a one-time bundled-JSON load, not network/user I/O — same
 * characterisation the task brief uses to justify pre-resolving regulation
 * refs "up front".)
 */
export function runDetectors(ctx: DetectorContext): Finding[] {
  const { model, config } = ctx;

  const raw: Finding[] = [
    ...basketSneaking(model, config),
    ...falseUrgency(model, config),
    ...interfaceInterference(model, config),
    ...dripPricing(model, config),
  ];

  raw.sort((a, b) => {
    const ka = locationSortKey(a.location);
    const kb = locationSortKey(b.location);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const perRuleCounter = new Map<string, number>();
  for (const finding of raw) {
    const next = (perRuleCounter.get(finding.ruleId) ?? 0) + 1;
    perRuleCounter.set(finding.ruleId, next);
    finding.findingId = `F-${finding.ruleId}-${next}`;
    finding.regulation = regulationRefsFor(finding.pattern);
    finding.attempts = 0;
    finding.status = "open";
  }

  return raw;
}

/**
 * Companion to `runDetectors` that ALSO surfaces detector-level warnings
 * (e.g. PRICE_FLOW_NOT_CONFIGURED, LABEL_NOT_FOUND,
 * COUNTDOWN_WITHOUT_URGENCY_TEXT, cascade UNSUPPORTED_* warnings) — see
 * KNOWN RISKS in the handoff report for why this is a separate, additive
 * export rather than a change to `runDetectors`'s return shape (which
 * packages/cli already depends on as a plain Finding[]).
 */
export function runDetectorsWithWarnings(ctx: DetectorContext): { findings: Finding[]; warnings: DetectorWarning[] } {
  const { model, config } = ctx;
  const findings = runDetectors(ctx);
  const warnings: DetectorWarning[] = [
    ...model.warnings.map((w) => ({ code: w.code, message: w.message, file: w.file })),
    ...basketSneakingWarnings(model, config),
    ...falseUrgencyWarnings(model, config),
    ...interfaceInterferenceWarnings(model, config),
    ...dripPricingWarnings(model, config),
  ];
  return { findings, warnings };
}
