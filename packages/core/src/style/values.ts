// CSS value resolution — Spec Section 9.4 "Values".
// Lengths: px as-is, rem*16, em*16 (+EM_APPROXIMATED warning), unitless 0.
// var(--x): resolved only from :root custom properties.
// font-weight: numbers, normal=400, bold=700.
// Colors: delegated to style/color.ts.
// Anything else resolves to null (unresolved) — callers must treat that as
// "signal does not fire" + emit a warning, never silently "fine" (I-12).

import type { WarningCode } from "../types.js";
import { parseColor, type RgbaColor } from "./color.js";

export interface ValueWarning {
  code: WarningCode;
  message: string;
}

export interface Resolved<T> {
  value: T;
  warnings: ValueWarning[];
}

const VAR_RE = /^var\(\s*(--[a-zA-Z0-9-_]+)\s*\)$/;

/** Expands a single `var(--x)` reference against :root custom properties.
 * Returns undefined (unresolved) if the raw text is not a var() reference
 * at all, or if the referenced variable is not declared on :root. */
export function expandVar(raw: string, rootVars: Record<string, string>): string | undefined {
  const match = VAR_RE.exec(raw.trim());
  if (!match) return undefined;
  const name = match[1] as string;
  return Object.prototype.hasOwnProperty.call(rootVars, name) ? rootVars[name] : undefined;
}

/** Resolves a raw CSS value, expanding var(--x) against :root first if
 * present. Returns the (possibly var-expanded) literal text, or null if a
 * var() reference could not be resolved. */
export function expandValue(raw: string, rootVars: Record<string, string>): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("var(")) {
    const expanded = expandVar(trimmed, rootVars);
    return expanded === undefined ? null : expanded.trim();
  }
  return trimmed;
}

const LENGTH_RE = /^(-?[0-9]*\.?[0-9]+)(px|rem|em)$/;

export function resolveLength(raw: string): Resolved<number> | null {
  const trimmed = raw.trim();
  if (trimmed === "0") return { value: 0, warnings: [] };

  const match = LENGTH_RE.exec(trimmed);
  if (!match) return null;
  const num = Number(match[1]);
  const unit = match[2];
  if (unit === "px") return { value: num, warnings: [] };
  if (unit === "rem") return { value: num * 16, warnings: [] };
  if (unit === "em") {
    return {
      value: num * 16,
      warnings: [{ code: "EM_APPROXIMATED", message: `em unit "${trimmed}" approximated as ${num}*16px` }],
    };
  }
  return null;
}

export function resolveFontWeight(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "normal") return 400;
  if (trimmed === "bold") return 700;
  const num = Number(trimmed);
  if (Number.isFinite(num) && trimmed.length > 0) return num;
  return null;
}

export function resolveColorValue(
  raw: string,
  rootVars: Record<string, string>,
): Resolved<RgbaColor> | null {
  const expanded = expandValue(raw, rootVars);
  if (expanded === null) return null;
  const color = parseColor(expanded);
  if (!color) return null;
  return { value: color, warnings: [] };
}
