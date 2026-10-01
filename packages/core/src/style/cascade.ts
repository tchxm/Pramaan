// Cascade resolution — Spec Section 9.4.
// resolveStyle(element, ctx) computes, per CSS property, the winning
// declaration among inline style, matching stylesheet rules and className,
// following: !important > normal; inline > stylesheet; specificity
// (ids, classes, types); then source order (stylesheet import order via a
// depth-first walk from config.entry, then rule order within file).
//
// Selector support is intentionally narrow (type/class/id/compound,
// descendant ' ' and child '>' combinators, :hover/:focus ignored).
// Everything else produces a warning and is never treated as matching (I-12).

import parser from "postcss-selector-parser";
import path from "node:path";
import { parseExpression } from "@babel/parser";
import * as t from "@babel/types";
import type { CascadeEntry, WarningCode } from "../types.js";
import type { JsxElementNode, ProjectModel } from "../parser/model.js";
import type { PramaanConfig } from "../config.js";
import { resolveColorValue } from "./values.js";
import type { RgbaColor } from "./color.js";

export interface CascadeWarning {
  code: WarningCode;
  message: string;
}

export interface ResolvedStyleProperty {
  value: string;
  important: boolean;
  winnerEntry: CascadeEntry;
  contenders: CascadeEntry[];
}

export type ResolvedStyle = Record<string, ResolvedStyleProperty>;

export interface ResolveStyleResult {
  result: ResolvedStyle;
  warnings: CascadeWarning[];
}

export interface CascadeContext {
  projectModel: ProjectModel;
  config: PramaanConfig;
  /** POSIX-relative path of the file containing `element`. */
  filePath: string;
}

// ---------- selector parsing ----------

interface Compound {
  tag?: string;
  id?: string;
  classes: string[];
  /** combinator connecting the PREVIOUS compound to this one; null for the
   * first (leftmost) compound. */
  combinator: " " | ">" | null;
}

type SelectorParseResult = { compounds: Compound[] } | { unsupported: true };

function parseSupportedSelector(selectorText: string): SelectorParseResult {
  let unsupported = false;
  const compounds: Compound[] = [];
  let current: Compound = { classes: [], combinator: null };
  let pendingCombinator: " " | ">" | null = null;
  let sawAnyNode = false;

  try {
    parser((root) => {
      root.walk((node) => {
        sawAnyNode = true;
        switch (node.type) {
          case "tag":
            current.tag = (node as parser.Tag).value.toLowerCase();
            break;
          case "class":
            current.classes.push((node as parser.ClassName).value);
            break;
          case "id":
            current.id = (node as parser.Identifier).value;
            break;
          case "universal":
            break;
          case "pseudo": {
            const value = (node as parser.Pseudo).value;
            if (value !== ":hover" && value !== ":focus") unsupported = true;
            break;
          }
          case "combinator": {
            const raw = (node as parser.Combinator).value;
            const trimmed = raw.trim();
            compounds.push({ ...current, combinator: pendingCombinator });
            current = { classes: [], combinator: null };
            if (trimmed === "") {
              pendingCombinator = " ";
            } else if (trimmed === ">") {
              pendingCombinator = ">";
            } else {
              unsupported = true;
              pendingCombinator = ">"; // placeholder; result discarded
            }
            break;
          }
          case "attribute":
            unsupported = true;
            break;
          case "nesting":
            unsupported = true;
            break;
          default:
            break;
        }
      });
    }).processSync(selectorText);
  } catch {
    return { unsupported: true };
  }

  if (!sawAnyNode) return { unsupported: true };
  compounds.push({ ...current, combinator: pendingCombinator });
  if (unsupported) return { unsupported: true };
  return { compounds };
}

function specificityOf(compounds: Compound[]): [number, number, number] {
  let ids = 0;
  let classes = 0;
  let types = 0;
  for (const c of compounds) {
    if (c.id) ids += 1;
    classes += c.classes.length;
    if (c.tag) types += 1;
  }
  return [ids, classes, types];
}

// ---------- element matching ----------

function elementClasses(el: JsxElementNode): string[] {
  const attr = el.attributes.find((a) => a.name === "className");
  if (attr && typeof attr.literalValue === "string") {
    return attr.literalValue.split(/\s+/).filter(Boolean);
  }
  return [];
}

function elementId(el: JsxElementNode): string | undefined {
  const attr = el.attributes.find((a) => a.name === "id");
  return typeof attr?.literalValue === "string" ? attr.literalValue : undefined;
}

function compoundMatches(compound: Compound, el: JsxElementNode): boolean {
  if (compound.tag && compound.tag !== el.tag.toLowerCase()) return false;
  if (compound.id && compound.id !== elementId(el)) return false;
  if (compound.classes.length > 0) {
    const classes = elementClasses(el);
    for (const c of compound.classes) {
      if (!classes.includes(c)) return false;
    }
  }
  return true;
}

/** Matches a parsed selector's compound chain against `el` using only
 * ancestors reachable via el.parent (i.e. within the same component's JSX
 * tree, per spec 9.4). Returns "no-match", "match", or "unknown-ancestor"
 * (needed more ancestors than the tree has). */
function matchCompounds(compounds: Compound[], el: JsxElementNode): "match" | "no-match" | "unknown-ancestor" {
  const rightmost = compounds[compounds.length - 1];
  if (!rightmost || !compoundMatches(rightmost, el)) return "no-match";

  let compoundIdx = compounds.length - 2;
  let cursor: JsxElementNode | null = el;

  while (compoundIdx >= 0) {
    const compound = compounds[compoundIdx + 1] as Compound; // the one we just matched
    const combinator = compound.combinator;
    const target = compounds[compoundIdx] as Compound;

    if (combinator === ">") {
      const next: JsxElementNode | null = cursor ? cursor.parent : null;
      if (!next) return "unknown-ancestor";
      if (!compoundMatches(target, next)) return "no-match";
      cursor = next;
      compoundIdx -= 1;
      continue;
    }

    // descendant combinator: search upward until match or exhausted
    let found = false;
    let walker: JsxElementNode | null = cursor ? cursor.parent : null;
    while (walker) {
      if (compoundMatches(target, walker)) {
        found = true;
        cursor = walker;
        break;
      }
      walker = walker.parent;
    }
    if (!found) return "unknown-ancestor";
    compoundIdx -= 1;
  }

  return "match";
}

// ---------- inline style parsing ----------

const UNITLESS_PROPS = new Set([
  "opacity",
  "fontWeight",
  "font-weight",
  "lineHeight",
  "line-height",
  "zIndex",
  "z-index",
  "flex",
  "flexGrow",
  "flexShrink",
]);

function camelToKebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function literalPropValue(node: t.Node): string | number | undefined {
  if (t.isStringLiteral(node)) return node.value;
  if (t.isNumericLiteral(node)) return node.value;
  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return node.quasis.map((q) => q.value.cooked ?? "").join("");
  }
  return undefined;
}

/** Parses `style={{...}}` object-literal source text into CSS declarations.
 * Returns null if the expression isn't a literal object we can statically
 * read (spec 9.4: "inline style={{...}} object literals with literal
 * values"). */
function parseInlineStyle(expressionSource: string): { property: string; value: string }[] | null {
  let expr: t.Expression;
  try {
    expr = parseExpression(expressionSource, { plugins: ["jsx", "typescript"] });
  } catch {
    return null;
  }
  if (!t.isObjectExpression(expr)) return null;
  const decls: { property: string; value: string }[] = [];
  for (const prop of expr.properties) {
    if (!t.isObjectProperty(prop)) continue;
    const key = t.isIdentifier(prop.key) ? prop.key.name : t.isStringLiteral(prop.key) ? prop.key.value : undefined;
    if (!key) continue;
    const literal = literalPropValue(prop.value);
    if (literal === undefined) continue;
    const property = camelToKebab(key);
    const value =
      typeof literal === "number" && !UNITLESS_PROPS.has(key) && !UNITLESS_PROPS.has(property)
        ? `${literal}px`
        : String(literal);
    decls.push({ property, value });
  }
  return decls;
}

// ---------- source order (depth-first import walk from config.entry) ----------

const IMPORT_RE = /import\s+(?:[^'";]*?from\s+)?["']([^"']+)["']/g;

function extractFileImports(source: string): string[] {
  const specs: string[] = [];
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(source))) {
    specs.push(m[1] as string);
  }
  return specs;
}

function resolveImportSpecifier(
  fromFile: string,
  specifier: string,
  allPaths: Set<string>,
): string | null {
  if (!specifier.startsWith(".")) return null; // external module
  const dir = path.posix.dirname(fromFile);
  const joined = path.posix.normalize(path.posix.join(dir, specifier));
  const candidates = [
    joined,
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}.js`,
    `${joined}.jsx`,
    `${joined}.css`,
    path.posix.join(joined, "index.ts"),
    path.posix.join(joined, "index.tsx"),
  ];
  for (const c of candidates) {
    if (allPaths.has(c)) return c;
  }
  return null;
}

function computeCssSourceOrder(projectModel: ProjectModel, config: PramaanConfig): Map<string, number> {
  const sourceByPath = new Map<string, string>();
  for (const f of projectModel.files) sourceByPath.set(f.path, f.source);
  const cssPaths = new Set(projectModel.cssFiles.map((c) => c.path));
  const allPaths = new Set<string>([...sourceByPath.keys(), ...cssPaths]);

  const visited = new Set<string>();
  const order: string[] = [];

  function dfs(filePath: string): void {
    if (visited.has(filePath)) return;
    visited.add(filePath);
    if (cssPaths.has(filePath)) {
      order.push(filePath);
      return;
    }
    const source = sourceByPath.get(filePath);
    if (source === undefined) return;
    for (const spec of extractFileImports(source)) {
      const resolved = resolveImportSpecifier(filePath, spec, allPaths);
      if (resolved) dfs(resolved);
    }
  }

  dfs(config.entry);

  const unreached = [...cssPaths].filter((p) => !visited.has(p)).sort();
  order.push(...unreached);

  const map = new Map<string, number>();
  order.forEach((p, i) => map.set(p, i));
  return map;
}

// ---------- public API ----------

interface WorkingEntry {
  entry: CascadeEntry;
  order: number; // global source-order key; higher = later
}

export function resolveStyle(element: JsxElementNode, ctx: CascadeContext): ResolveStyleResult {
  const warnings: CascadeWarning[] = [];
  const byProperty = new Map<string, WorkingEntry[]>();

  function push(entry: CascadeEntry, order: number): void {
    const list = byProperty.get(entry.property) ?? [];
    list.push({ entry, order });
    byProperty.set(entry.property, list);
  }

  // 1. inline style
  const styleAttr = element.attributes.find((a) => a.name === "style");
  if (styleAttr?.expressionSource) {
    const decls = parseInlineStyle(styleAttr.expressionSource);
    if (decls === null) {
      warnings.push({
        code: "UNSUPPORTED_STYLE_SOURCE",
        message: `style expression on <${element.tag}> at ${ctx.filePath} is not a static object literal`,
      });
    } else {
      decls.forEach((decl, i) => {
        push(
          {
            property: decl.property,
            value: decl.value,
            important: false,
            file: ctx.filePath,
            selector: "(inline)",
            line: element.range.startLine,
            specificity: [0, 0, 0],
            origin: "inline",
            winner: false,
          },
          i,
        );
      });
    }
  }

  const classNameAttr = element.attributes.find((a) => a.name === "className");
  if (classNameAttr && classNameAttr.expressionSource !== undefined) {
    warnings.push({
      code: "UNSUPPORTED_STYLE_SOURCE",
      message: `className expression on <${element.tag}> at ${ctx.filePath} is not a static string/template literal`,
    });
  }

  // 2. stylesheet rules
  const cssOrder = computeCssSourceOrder(ctx.projectModel, ctx.config);
  for (const cssFile of ctx.projectModel.cssFiles) {
    const fileOrder = cssOrder.get(cssFile.path) ?? Number.MAX_SAFE_INTEGER;
    for (const rule of cssFile.rules) {
      if (rule.unsupportedAtRule) {
        warnings.push({
          code: "UNSUPPORTED_STYLE_SOURCE",
          message: `rule "${rule.selector}" inside @${rule.unsupportedAtRule} in ${cssFile.path} is not resolved`,
        });
        continue;
      }
      const parsed = parseSupportedSelector(rule.selector);
      if ("unsupported" in parsed) {
        warnings.push({
          code: "UNSUPPORTED_SELECTOR",
          message: `selector "${rule.selector}" in ${cssFile.path}:${rule.line} uses an unsupported construct`,
        });
        continue;
      }
      const matchResult = matchCompounds(parsed.compounds, element);
      if (matchResult === "unknown-ancestor") {
        warnings.push({
          code: "ANCESTOR_CONTEXT_UNKNOWN",
          message: `selector "${rule.selector}" in ${cssFile.path}:${rule.line} needs ancestor context outside ${ctx.filePath}`,
        });
        continue;
      }
      if (matchResult === "no-match") continue;

      const specificity = specificityOf(parsed.compounds);
      const order = fileOrder * 1_000_000 + rule.sourceOrder;
      for (const decl of rule.declarations) {
        push(
          {
            property: decl.property,
            value: decl.value,
            important: decl.important,
            file: cssFile.path,
            selector: rule.selector,
            line: decl.line || rule.line,
            specificity,
            origin: "stylesheet",
            winner: false,
          },
          order,
        );
      }
    }
  }

  // 3. pick winner per property
  const result: ResolvedStyle = {};
  for (const [property, entries] of byProperty) {
    const sorted = [...entries].sort((a, b) => {
      if (a.entry.important !== b.entry.important) return a.entry.important ? -1 : 1;
      if (a.entry.origin !== b.entry.origin) return a.entry.origin === "inline" ? -1 : 1;
      for (let i = 0; i < 3; i++) {
        const diff = (b.entry.specificity[i] ?? 0) - (a.entry.specificity[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return b.order - a.order;
    });
    const winner = sorted[0];
    if (!winner) continue;
    const contenders = sorted.map((w, i) => ({ ...w.entry, winner: i === 0 }));
    result[property] = {
      value: winner.entry.value,
      important: winner.entry.important,
      winnerEntry: { ...winner.entry, winner: true },
      contenders,
    };
  }

  return { result, warnings };
}

// ---------- background resolution (spec 9.5) ----------

export interface ResolvedBackground {
  color: RgbaColor;
  warnings: CascadeWarning[];
}

function mergedRootVars(projectModel: ProjectModel): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const cssFile of projectModel.cssFiles) Object.assign(vars, cssFile.rootVars);
  return vars;
}

/** Background: the element's own resolved background-color, else the
 * nearest ancestor's within the same file, else #ffffff with warning
 * BACKGROUND_ASSUMED_WHITE (spec 9.5). */
export function resolveBackgroundColor(element: JsxElementNode, ctx: CascadeContext): ResolvedBackground {
  const rootVars = mergedRootVars(ctx.projectModel);
  const warnings: CascadeWarning[] = [];
  let cursor: JsxElementNode | null = element;
  while (cursor) {
    const { result, warnings: styleWarnings } = resolveStyle(cursor, ctx);
    warnings.push(...styleWarnings);
    const bg = result["background-color"] ?? result["background"];
    if (bg) {
      const resolved = resolveColorValue(bg.value, rootVars);
      if (resolved) {
        return { color: resolved.value, warnings };
      }
    }
    cursor = cursor.parent;
  }
  warnings.push({
    code: "BACKGROUND_ASSUMED_WHITE",
    message: `no resolvable background-color found for <${element.tag}> or its ancestors in ${ctx.filePath}; assuming #ffffff`,
  });
  return { color: { r: 255, g: 255, b: 255, a: 1 }, warnings };
}
