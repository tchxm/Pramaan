// WCAG contrast computation — Spec Section 9.5, formulas verbatim.

import { compositeOver, parseColor, type RgbaColor } from "./color.js";

export function toLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(fg: RgbaColor, bg: RgbaColor): number {
  const lFg = luminance(fg.r, fg.g, fg.b);
  const lBg = luminance(bg.r, bg.g, bg.b);
  return (Math.max(lFg, lBg) + 0.05) / (Math.min(lFg, lBg) + 0.05);
}

/** Convenience for the reference-vector tests and callers that only have
 * color strings on hand (no alpha/opacity compositing). Returns null if
 * either color string is unresolved. */
export function contrastRatioFromStrings(fg: string, bg: string): number | null {
  const fgColor = parseColor(fg);
  const bgColor = parseColor(bg);
  if (!fgColor || !bgColor) return null;
  return contrastRatio(fgColor, bgColor);
}

/** Full resolution per spec 9.5: composite fg over bg (alpha), then
 * composite the result over bg again using `opacity` as the alpha
 * (documented approximation for element opacity). */
export function resolveEffectiveContrast(
  fg: RgbaColor,
  bg: RgbaColor,
  opacity: number,
): number {
  const composited = compositeOver(fg, bg);
  const withOpacity = opacity >= 1 ? composited : compositeOver({ ...composited, a: opacity }, bg);
  return contrastRatio(withOpacity, bg);
}
