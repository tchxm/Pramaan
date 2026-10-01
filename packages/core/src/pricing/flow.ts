// Checkout-flow / fee-item discovery for detectors/dripPricing.ts — Spec 10.4.
// Pure functions over an already-loaded FileModel + resolved constant maps.
// No I/O.

import type { FileModel, JsxElementNode, SourceRange } from "../parser/model.js";
import { elementText, rawSlice, walkFileElements } from "../detectors/util.js";
import { extractIdentifierAmounts, extractLiteralAmounts, type ExtractedAmount } from "./extract.js";

export const FEE_LABEL_RE =
  /handling|protection|convenience|platform|packaging|service fee|processing|surge|delivery fee|shipping|packing/i;

const CONTAINER_TAGS = new Set(["li", "tr", "div", "p"]);

export interface FeeItemObservation {
  label: string;
  amount: number;
  mandatory: boolean;
  boundIdentifier: string | null;
  range: SourceRange;
  raw: string;
}

/** Finds `{ident && <Elem>...}` / `ident ? <Elem>...: null` conditional
 * spans in a component's raw source, each associated with the bound
 * identifier. Uses a simple brace-depth scan from the opening `{` — does
 * not fully understand JS string/template literal nesting (documented
 * limitation; acceptable for the plain JSX this detector targets). Offsets
 * are relative to `source` (the whole file), since `startOffset` is passed
 * in already absolute. */
function findConditionalSpans(source: string, fromOffset: number, toOffset: number): { start: number; end: number; ident: string }[] {
  const spans: { start: number; end: number; ident: string }[] = [];
  const re = /\{\s*([A-Za-z_$][\w$]*)\s*(&&|\?)/g;
  re.lastIndex = fromOffset;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) && m.index < toOffset) {
    const openIdx = m.index;
    let depth = 0;
    let end = -1;
    for (let i = openIdx; i < toOffset; i++) {
      const ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end === -1) end = toOffset;
    spans.push({ start: openIdx, end, ident: m[1] as string });
    re.lastIndex = openIdx + 1; // allow nested/overlapping scans
  }
  return spans;
}

function findAmountNear(text: string, localConsts: Record<string, number>, feeConstants: Record<string, number>, currencyTokens: string[]): ExtractedAmount | undefined {
  const literal = extractLiteralAmounts(text, currencyTokens);
  const identifier = extractIdentifierAmounts(text, localConsts, feeConstants, currencyTokens);
  const all = [...literal, ...identifier].sort((a, b) => a.index - b.index);
  return all[0];
}

/** Discovers fee items in one step file: an amount within the same
 * "container" JSX element (li/tr/div/p, spec 10.4) as a label matching
 * FEE_LABEL_RE, innermost-container-wins when nested containers both
 * contain the match. */
export function findFeeItems(
  file: FileModel,
  localConsts: Record<string, number>,
  feeConstants: Record<string, number>,
  currencyTokens: string[],
): FeeItemObservation[] {
  const candidates: { el: JsxElementNode; componentStart: number; componentEnd: number }[] = [];
  for (const { component, el } of walkFileElements(file)) {
    if (!CONTAINER_TAGS.has(el.tag)) continue;
    const text = elementText(el) || rawSlice(file, el.range);
    if (!FEE_LABEL_RE.test(text)) continue;
    candidates.push({ el, componentStart: component.range.startOffset, componentEnd: component.range.endOffset });
  }

  // Innermost-wins: drop any candidate whose range strictly contains another.
  const kept = candidates.filter((c) => {
    return !candidates.some(
      (o) =>
        o !== c &&
        o.el.range.startOffset >= c.el.range.startOffset &&
        o.el.range.endOffset <= c.el.range.endOffset &&
        (o.el.range.startOffset > c.el.range.startOffset || o.el.range.endOffset < c.el.range.endOffset),
    );
  });

  const out: FeeItemObservation[] = [];
  for (const { el, componentStart, componentEnd } of kept) {
    const raw = rawSlice(file, el.range);
    const amountMatch = findAmountNear(raw, localConsts, feeConstants, currencyTokens);
    if (!amountMatch) continue;

    const labelMatch = FEE_LABEL_RE.exec(raw);
    const spans = findConditionalSpans(file.source, componentStart, componentEnd);
    const wrapping = spans.find((s) => s.start <= el.range.startOffset && el.range.endOffset <= s.end);

    out.push({
      label: labelMatch ? labelMatch[0] : raw,
      amount: amountMatch.amount,
      mandatory: !wrapping,
      boundIdentifier: wrapping ? wrapping.ident : null,
      range: el.range,
      raw,
    });
  }
  return out;
}

/** Whether a step file displays at least one price anywhere (spec 10.4:
 * "an earlier step displays at least one price"). */
export function hasAnyDisplayedPrice(
  file: FileModel,
  localConsts: Record<string, number>,
  feeConstants: Record<string, number>,
  currencyTokens: string[],
): boolean {
  const literal = extractLiteralAmounts(file.source, currencyTokens);
  const identifier = extractIdentifierAmounts(file.source, localConsts, feeConstants, currencyTokens);
  return literal.length > 0 || identifier.length > 0;
}

/** All amounts (literal + identifier-resolved) visible anywhere in a step
 * file, sorted by source position — used for evidence.observed's
 * initialDisplayedPrice/finalTotal best-effort fields. */
export function allDisplayedAmounts(
  file: FileModel,
  localConsts: Record<string, number>,
  feeConstants: Record<string, number>,
  currencyTokens: string[],
): ExtractedAmount[] {
  const literal = extractLiteralAmounts(file.source, currencyTokens);
  const identifier = extractIdentifierAmounts(file.source, localConsts, feeConstants, currencyTokens);
  return [...literal, ...identifier].sort((a, b) => a.index - b.index);
}
