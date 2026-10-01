// scripts/make-variants.ts
//
// Generates mutated copies of F01, F02, F05 and F06 into fixtures/variants/,
// to regression-test detectors against renamed/reordered/reworded code
// instead of the literal fixture source (Section 19.9 of the spec).
//
// Intentionally fixture-aware: this is NOT a generic AST-rewriting tool.
// Each source fixture gets its own small, targeted list of string
// replacements (identifier renames, class renames, amount changes, label
// synonyms, an extra wrapper <div>, and light reordering). The whole point
// of this script is to prove the detectors don't secretly key off of
// hardcoded fixture identifiers/text/amounts — so keeping the replacements
// simple and explicit (rather than a "smart" generic renamer) is the
// correct design here, not a shortcut.
//
// Run with: node --experimental-strip-types scripts/make-variants.ts
// (plain JS syntax is used throughout so this also runs unmodified under
// `node scripts/make-variants.ts` once Node's default TS support lands, or
// under `tsx scripts/make-variants.ts` if tsx is installed.)

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const fixturesRoot = path.join(repoRoot, "fixtures");
const variantsRoot = path.join(fixturesRoot, "variants");

/**
 * Common text-level mutations shared by every variant:
 *  - protection -> addOn                   (identifier rename)
 *  - decline -> dismiss                    (class rename, TSX + CSS)
 *  - 49 -> 59, 39 -> 45                     (amount changes)
 *  - "Delivery Protection" -> "Parcel Cover" (synonym label)
 */
function applyCommonMutations(source) {
  let out = source;

  // Rename the `protection` state/identifier to `addOn` (word-boundary safe,
  // case-sensitive; does not touch `Protection` used in the label text,
  // which is handled by the synonym-label replacement below).
  out = out.replace(/\bprotection\b/g, "addOn");
  out = out.replace(/\bsetProtection\b/g, "setAddOn");

  // Rename the `decline` class consistently across TSX className and CSS
  // selectors.
  out = out.replace(/\bdecline\b/g, "dismiss");

  // Amount changes.
  out = out.replace(/49/g, "59");
  out = out.replace(/39/g, "45");

  // Synonym label.
  out = out.replace(/Delivery Protection/g, "Parcel Cover");

  return out;
}

/**
 * Wraps the component's JSX return value in an extra <div>.
 *
 * There can be several `return (` occurrences in a file (e.g. inside a
 * `useEffect` cleanup closure). We only want the one whose parenthesised
 * body is actual JSX, i.e. the first non-whitespace character after
 * `return (` is `<`. We scan every `return (` occurrence and wrap the
 * first one that qualifies.
 */
function wrapReturnInExtraDiv(source) {
  const marker = "return (";
  let searchFrom = 0;

  while (true) {
    const idx = source.indexOf(marker, searchFrom);
    if (idx === -1) return source; // no qualifying JSX return found

    const start = idx + marker.length;
    const afterMarker = source.slice(start).match(/^\s*/)?.[0].length ?? 0;
    const firstChar = source[start + afterMarker];

    if (firstChar !== "<") {
      // Not a JSX return (e.g. `return (\n    <div/>\n  ) => clearInterval(id)`
      // style arrow bodies do not occur here, but other non-JSX parens do).
      searchFrom = start;
      continue;
    }

    // Find the matching closing `)` by paren-depth counting from `start`.
    let depth = 1;
    let i = start;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) return source; // unbalanced, bail out safely

    const inner = source.slice(start, i);
    const wrapped = `\n    <div className="variant-wrapper">${inner}</div>\n  `;
    return source.slice(0, start) + wrapped + source.slice(i);
  }
}

/**
 * Reorders two adjacent sibling JSX lines, but only when each candidate
 * line is a fully self-contained element on its own line (self-closing, or
 * opening+closing tag both on that line) — never a bare opening tag of a
 * multi-line block. This keeps the mutation from corrupting JSX nesting.
 */
function reorderSiblings(source, firstNeedle, secondNeedle) {
  const isSelfContained = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("<")) return false;
    return /\/>\s*$/.test(trimmed) || /<\/[A-Za-z][\w.]*>\s*$/.test(trimmed);
  };

  const lines = source.split("\n");
  const firstIdx = lines.findIndex((l) => l.includes(firstNeedle));
  const secondIdx = lines.findIndex((l) => l.includes(secondNeedle));
  if (firstIdx === -1 || secondIdx === -1 || secondIdx !== firstIdx + 1) {
    return source; // not simple adjacent siblings; skip rather than risk breaking JSX
  }
  if (!isSelfContained(lines[firstIdx]) || !isSelfContained(lines[secondIdx])) {
    return source; // one side is a multi-line block; skip to avoid breaking nesting
  }

  const swapped = [...lines];
  [swapped[firstIdx], swapped[secondIdx]] = [swapped[secondIdx], swapped[firstIdx]];
  return swapped.join("\n");
}

function copyDirRecursive(srcDir, destDir, transformFile) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "variant") continue;
    const srcPath = path.join(srcDir, entry);
    const destPath = path.join(destDir, entry);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      copyDirRecursive(srcPath, destPath, transformFile);
    } else {
      const raw = readFileSync(srcPath, "utf8");
      const transformed = transformFile(entry, raw);
      writeFileSync(destPath, transformed);
    }
  }
}

function rewritePackageName(destDir, newName) {
  const pkgPath = path.join(destDir, "package.json");
  if (!existsSync(pkgPath)) return;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.name = newName;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

function buildVariant(sourceFixture, variantName, extraFileTransform) {
  const srcDir = path.join(fixturesRoot, sourceFixture);
  const destDir = path.join(variantsRoot, variantName);
  if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });

  copyDirRecursive(srcDir, destDir, (filename, content) => {
    const isTextTarget = /\.(tsx|ts|css|json|html)$/.test(filename);
    if (!isTextTarget) return content;

    let out = content;
    // Don't mutate expected.json's own filename check; still apply common
    // mutations so the labels referenced in it (if any) stay consistent.
    out = applyCommonMutations(out);
    if (extraFileTransform) out = extraFileTransform(filename, out);
    return out;
  });

  rewritePackageName(destDir, variantName);
  return destDir;
}

function readExpected(sourceFixture) {
  const p = path.join(fixturesRoot, sourceFixture, "expected.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

function writeVariantExpected(variantDir, expected) {
  // Same finding counts as the source fixture (that's the whole point of a
  // variant: prove detection survives renames, not that the number changes).
  writeFileSync(path.join(variantDir, "expected.json"), JSON.stringify(expected, null, 2) + "\n");
}

// ---------------------------------------------------------------------
// F01 variant
// ---------------------------------------------------------------------
{
  const variantName = "f01-basket-simple-variant";
  const destDir = buildVariant("f01-basket-simple", variantName, (filename, content) => {
    if (filename !== "Cart.tsx") return content;
    let out = wrapReturnInExtraDiv(content);
    out = reorderSiblings(
      out,
      "Organic Coffee",
      "<label>"
    );
    return out;
  });
  writeVariantExpected(destDir, readExpected("f01-basket-simple"));
  console.log(`wrote ${variantName}`);
}

// ---------------------------------------------------------------------
// F02 variant
// ---------------------------------------------------------------------
{
  const variantName = "f02-css-cascade-variant";
  const destDir = buildVariant("f02-css-cascade", variantName, (filename, content) => {
    if (filename !== "Cart.tsx") return content;
    let out = wrapReturnInExtraDiv(content);
    out = reorderSiblings(out, "cta-yes", "dismiss"); // decline -> dismiss already applied
    return out;
  });
  writeVariantExpected(destDir, readExpected("f02-css-cascade"));
  console.log(`wrote ${variantName}`);
}

// ---------------------------------------------------------------------
// F05 variant
// ---------------------------------------------------------------------
{
  const variantName = "f05-drip-pricing-variant";
  const destDir = buildVariant("f05-drip-pricing", variantName, (filename, content) => {
    if (filename !== "Payment.tsx") return content;
    return wrapReturnInExtraDiv(content);
  });
  writeVariantExpected(destDir, readExpected("f05-drip-pricing"));
  console.log(`wrote ${variantName}`);
}

// ---------------------------------------------------------------------
// F06 variant
// ---------------------------------------------------------------------
{
  const variantName = "f06-mitti-mart-variant";
  const destDir = buildVariant("f06-mitti-mart", variantName, (filename, content) => {
    if (filename === "Cart.tsx") {
      let out = wrapReturnInExtraDiv(content);
      out = reorderSiblings(out, "cta-yes", "dismiss");
      return out;
    }
    return content;
  });
  writeVariantExpected(destDir, readExpected("f06-mitti-mart"));
  console.log(`wrote ${variantName}`);
}

console.log("\nVariants written to fixtures/variants/. Run `npm install` at the repo root, then `npm run fixtures:build` to build them.");
