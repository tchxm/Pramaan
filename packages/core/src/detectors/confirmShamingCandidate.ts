// PRM-005 Confirm Shaming — CANDIDATE finder only. Spec Section 10.5.
//
// IMPORTANT (I-09 / invariant): core never invents Findings from LLM output,
// and core has no LLM client at all — packages/core never calls out to an
// LLM directly. A real Finding requires `likely:true` from a semantic
// classification step that only the agent package can perform (via its
// `semantic.inspect` tool, spec 10.5 step 2). This module therefore exposes
// only the deterministic step-1 candidate filter; it is NOT wired into
// runDetectors()'s Finding[] output (see detectors/index.ts).
//
// The agent engineer (A6) is expected to: call findConfirmShamingCandidates
// for each scanned file, run each candidate's anchorText through
// semantic.inspect, and for every `likely:true` result construct a Finding
// with:
//   ruleId: "PRM-005", pattern: "CONFIRM_SHAMING", detector: "SEMANTIC_CANDIDATE",
//   severity: "medium", score: null, requiresReview: true,
//   fingerprint: candidate.fingerprint (already computed with the same
//   computeFingerprint({ruleId:"PRM-005", file, componentName, jsxPath, anchorText})
//   convention as the other 4 detectors — do not recompute it differently),
//   location: candidate.location, regulation: (attach via lookupRegulation("CONFIRM_SHAMING")).

import type { SourceLocation } from "../types.js";
import type { ProjectModel } from "../parser/model.js";
import type { PramaanConfig } from "../config.js";
import { computeFingerprint } from "../fingerprint.js";
import { normalise } from "./util.js";
import { collectClickables } from "./pairs.js";

// Spec 10.5 step 1 — deterministic candidate filter on reject-side text.
const CANDIDATE_PATTERNS: RegExp[] = [
  /\bno thanks?,?\s+i\b/i,
  /\bi (?:don'?t|do not) (?:want|like|need) to (?:save|be|get|win|protect)/i,
  /\bi (?:prefer|like|love|enjoy) (?:paying|losing|wasting|missing|risk)/i,
  /\bno,? i (?:hate|don'?t care)/i,
  /\bnot interested in (?:saving|protecting|deals)/i,
];

export interface ConfirmShamingCandidate {
  location: SourceLocation;
  anchorText: string;
  componentName: string;
  jsxPath: string;
  fingerprint: string;
}

/**
 * Deterministic, pure, synchronous candidate finder — Spec 10.5 step 1 only.
 * Does NOT return Finding[] (no `likely` verdict is available in core).
 */
export function findConfirmShamingCandidates(model: ProjectModel, config: PramaanConfig): ConfirmShamingCandidate[] {
  const out: ConfirmShamingCandidate[] = [];

  for (const file of model.files) {
    for (const component of file.components) {
      if (!component.jsxRoot) continue;
      const clickables = collectClickables(component.jsxRoot, config);
      for (const c of clickables) {
        if (c.role !== "reject") continue;
        const text = normalise(c.text);
        const matched = CANDIDATE_PATTERNS.some((re) => re.test(text));
        if (!matched) continue;

        const fingerprint = computeFingerprint({
          ruleId: "PRM-005",
          file: file.path,
          componentName: component.name,
          jsxPath: c.el.jsxPath,
          anchorText: text,
        });

        out.push({
          location: {
            file: file.path,
            startLine: c.el.range.startLine,
            startColumn: c.el.range.startColumn,
            endLine: c.el.range.endLine,
            endColumn: c.el.range.endColumn,
          },
          anchorText: text,
          componentName: component.name,
          jsxPath: c.el.jsxPath,
          fingerprint,
        });
      }
    }
  }

  return out;
}
