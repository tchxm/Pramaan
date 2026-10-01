// Fingerprint rule — Spec Section 8.1.
// fingerprint = sha256(ruleId + "|" + file + "|" + componentName + "|" + jsxPath + "|" + anchorText)
// MUST NOT depend on attributes that fixes change (checked, style, className,
// initial state values) — none of those feed into this function's inputs.

import { createHash } from "node:crypto";
import type { RuleId } from "./types.js";

export function normaliseAnchorText(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, " ").trim();
}

export interface FingerprintInput {
  ruleId: RuleId;
  file: string;
  componentName: string; // enclosing function/class name, or "<anonymous>"
  jsxPath: string; // dot-joined child indexes from the component's JSX root
  anchorText: string; // will be normalised internally
}

export function computeFingerprint(input: FingerprintInput): string {
  const anchor = normaliseAnchorText(input.anchorText);
  const payload = `${input.ruleId}|${input.file}|${input.componentName}|${input.jsxPath}|${anchor}`;
  return createHash("sha256").update(payload).digest("hex");
}
