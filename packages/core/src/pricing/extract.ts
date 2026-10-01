// Amount extraction helpers used by detectors/dripPricing.ts — Spec 10.4.
// Pure text/regex utilities operating on already-loaded source strings.
// No I/O (the caller, dripPricing.ts, only ever hands in strings already
// present on the ProjectModel).

export interface ExtractedAmount {
  raw: string;
  amount: number;
  index: number;
}

const DEFAULT_TOKENS = ["₹", "Rs\\.?", "INR"];

function currencyAlternation(extraTokens: string[]): string {
  const all = new Set<string>(DEFAULT_TOKENS);
  for (const t of extraTokens) {
    if (t === "₹" || t === "Rs" || t === "INR") continue;
    all.add(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }
  return [...all].join("|");
}

/** Literal amounts: `(₹|Rs\.?|INR)\s?([0-9][0-9,]*(\.[0-9]+)?)` (spec 10.4),
 * extended with any extra tokens from config.currency. */
export function extractLiteralAmounts(text: string, currencyTokens: string[] = []): ExtractedAmount[] {
  const re = new RegExp(`(?:${currencyAlternation(currencyTokens)})\\s?([0-9][0-9,]*(?:\\.[0-9]+)?)`, "g");
  const out: ExtractedAmount[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const numStr = (m[1] as string).replace(/,/g, "");
    out.push({ raw: m[0], amount: Number(numStr), index: m.index });
  }
  return out;
}

/** Amounts referenced via a JSX expression identifier immediately after a
 * currency token, e.g. `₹{FEES.handling}`, `Rs{product}`. Resolved against
 * `localConsts` (same-file numeric `const`s) first, then `feeConstants`
 * (parsed from config.feeConstants's module source, dotted-path or bare
 * key). Spec 10.4: "identifiers resolving to module-level numeric
 * constants (same file or feeConstants)". */
export function extractIdentifierAmounts(
  text: string,
  localConsts: Record<string, number>,
  feeConstants: Record<string, number>,
  currencyTokens: string[] = [],
): ExtractedAmount[] {
  const re = new RegExp(`(?:${currencyAlternation(currencyTokens)})\\s*\\{\\s*([A-Za-z_$][\\w.$]*)\\s*\\}`, "g");
  const out: ExtractedAmount[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const ident = m[1] as string;
    const bare = ident.includes(".") ? (ident.split(".").pop() as string) : ident;
    const amount = localConsts[ident] ?? localConsts[bare] ?? feeConstants[ident] ?? feeConstants[bare];
    if (amount !== undefined) {
      out.push({ raw: m[0], amount, index: m.index });
    }
  }
  return out;
}

/** Numeric props on components named Price|Amount|Fee|Total|*Row, e.g.
 * `<PriceRow amount={39} />`. Best-effort structural scan over raw JSX
 * source since these may appear as literal attribute values captured by
 * the locked parser model too — kept here as a text-level fallback for
 * callers that only have source text on hand. */
export function extractComponentPropAmounts(text: string): ExtractedAmount[] {
  const re = /<(?:\w*(?:Price|Amount|Fee|Total|Row)\w*)\b[^>]*\b(?:amount|value|price)\s*=\s*\{?\s*([0-9]+(?:\.[0-9]+)?)\s*\}?/g;
  const out: ExtractedAmount[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({ raw: m[0], amount: Number(m[1]), index: m.index });
  }
  return out;
}

/** Parses a `feeConstants` module's source text (spec Appendix A: a STRING
 * path to a module such as "src/constants/fees.ts" exporting a numeric
 * map, e.g. `export const FEES = { handling: 39 }`) into a flat map keyed
 * both by "EXPORTNAME.key" and by bare "key" (when unambiguous). This is a
 * light regex scan of plain `key: number` pairs inside an
 * `export const X = {...}` object literal — safe because it is Pramaan's
 * own config-referenced source file, not arbitrary user code execution. */
export function parseFeeConstants(source: string): Record<string, number> {
  const out: Record<string, number> = {};
  const exportRe = /export\s+const\s+(\w+)\s*=\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = exportRe.exec(source))) {
    const exportName = m[1] as string;
    const body = m[2] as string;
    const pairRe = /([A-Za-z_$][\w$]*)\s*:\s*(-?[0-9]+(?:\.[0-9]+)?)/g;
    let p: RegExpExecArray | null;
    while ((p = pairRe.exec(body))) {
      const key = p[1] as string;
      const value = Number(p[2]);
      out[`${exportName}.${key}`] = value;
      if (!(key in out)) out[key] = value;
    }
  }
  return out;
}

/** Same-file top-level numeric `const NAME = 799;` declarations. */
export function parseLocalNumericConsts(source: string): Record<string, number> {
  const out: Record<string, number> = {};
  const re = /\bconst\s+(\w+)\s*=\s*(-?[0-9]+(?:\.[0-9]+)?)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    out[m[1] as string] = Number(m[2]);
  }
  return out;
}
