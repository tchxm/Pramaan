// Operation implementations — Spec Section 12.2.
// Every op is a range-based text edit computed from AST/CSS source locations
// of the CURRENT in-memory content of the affected file(s), so untouched
// code keeps its original formatting. We never regenerate a whole file from
// an AST (forbidden shortcut) — only the precise sub-ranges we touch are
// spliced.
//
// Attribute-level and declaration-level offsets are not present in the
// locked parser/model.ts shapes (JsxAttribute/CssDeclarationNode carry no
// SourceRange), so this module performs its OWN local re-parse (via
// @babel/parser / postcss, the same libraries parser/jsx.ts and
// parser/css.ts already use) purely to recover exact character offsets. It
// never modifies parser/*.ts and never trusts the re-parse for anything but
// offsets — postconditions are always re-verified via the locked
// parseJsxFile/parseCssFile.

import { parse as babelParse } from "@babel/parser";
import * as traverseNs from "@babel/traverse";
import type { NodePath, TraverseOptions } from "@babel/traverse";
import * as t from "@babel/types";
import postcss from "postcss";
import path from "node:path";
import type { PatchOp, SourceLocation, WarningCode, Finding } from "../types.js";
import type { PramaanConfig } from "../config.js";
import type { ComponentModel, JsxElementNode, UseStateHook, SourceRange } from "../parser/model.js";
import { parseJsxFile } from "../parser/jsx.js";
import { parseCssFile } from "../parser/css.js";
import { err } from "../errors.js";

type TraverseFn = (ast: t.Node, visitor: TraverseOptions) => void;
const traverseImpl = traverseNs as unknown as { default?: TraverseFn } & TraverseFn;
const traverse: TraverseFn = traverseImpl.default ?? traverseImpl;

export const CSS_PROPERTY_ALLOWLIST = new Set([
  "opacity",
  "font-size",
  "color",
  "display",
  "visibility",
  "width",
  "height",
  "left",
  "top",
]);

export const FEE_DISCLOSURE_PATH = "src/components/FeeDisclosure.tsx";

const FEE_DISCLOSURE_TEMPLATE = (constKey: string, label: string): string =>
  `import { FEES } from "../constants/fees";

export default function FeeDisclosure() {
  return (
    <p className="fee-disclosure">
      {\`+ ₹\${FEES.${constKey}} ${label} applies at payment\`}
    </p>
  );
}
`;

export interface ApplyOpContext {
  /** relPath (POSIX) -> current source. Mutated in place by applyOp. Must be
   * pre-populated with the content of every file an op may need to read;
   * new files (FeeDisclosure.tsx) are added to it. */
  files: Map<string, string>;
  /** relPaths created by an op during this application (for apply.ts's
   * rollback bookkeeping — these have no snapshot entry to restore). */
  createdFiles: Set<string>;
  config: PramaanConfig;
  finding: Finding;
}

export interface ApplyOpResult {
  warnings: WarningCode[];
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

function getFile(ctx: ApplyOpContext, relPath: string): string {
  const content = ctx.files.get(relPath);
  if (content === undefined) {
    throw err("E_TARGET_NOT_FOUND", `file ${relPath} not loaded into apply context`, { file: relPath });
  }
  return content;
}

function setFile(ctx: ApplyOpContext, relPath: string, content: string): void {
  ctx.files.set(relPath, content);
}

function applyEdits(source: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let result = source;
  for (const e of sorted) {
    result = result.slice(0, e.start) + e.text + result.slice(e.end);
  }
  return result;
}

// ---------- shared: locate a JsxElementNode by SourceLocation ----------

function pointLTE(aLine: number, aCol: number, bLine: number, bCol: number): boolean {
  return aLine < bLine || (aLine === bLine && aCol <= bCol);
}

function rangesEqual(r: SourceRange, loc: SourceLocation): boolean {
  return (
    r.startLine === loc.startLine &&
    r.startColumn === loc.startColumn &&
    r.endLine === loc.endLine &&
    r.endColumn === loc.endColumn
  );
}

function findExact(el: JsxElementNode, loc: SourceLocation): JsxElementNode | null {
  if (rangesEqual(el.range, loc)) return el;
  for (const c of el.children) {
    const r = findExact(c, loc);
    if (r) return r;
  }
  return null;
}

function findSmallestContaining(el: JsxElementNode, loc: SourceLocation): JsxElementNode | null {
  const withinStart = pointLTE(el.range.startLine, el.range.startColumn, loc.startLine, loc.startColumn);
  const withinEnd = pointLTE(loc.endLine, loc.endColumn, el.range.endLine, el.range.endColumn);
  if (!(withinStart && withinEnd)) return null;
  for (const c of el.children) {
    const r = findSmallestContaining(c, loc);
    if (r) return r;
  }
  return el;
}

export function locateElement(
  components: ComponentModel[],
  loc: SourceLocation,
): { element: JsxElementNode; component: ComponentModel } | null {
  for (const c of components) {
    if (!c.jsxRoot) continue;
    const exact = findExact(c.jsxRoot, loc);
    if (exact) return { element: exact, component: c };
  }
  for (const c of components) {
    if (!c.jsxRoot) continue;
    const contained = findSmallestContaining(c.jsxRoot, loc);
    if (contained) return { element: contained, component: c };
  }
  return null;
}

// ---------- shared: local raw re-parse for offset-level detail ----------

function parseRaw(source: string): t.File {
  return babelParse(source, { sourceType: "module", plugins: ["jsx", "typescript"], errorRecovery: false });
}

function findJsxElementByRange(ast: t.File, range: SourceRange): t.JSXElement | null {
  let found: t.JSXElement | null = null;
  traverse(ast, {
    JSXElement(p: NodePath<t.JSXElement>) {
      if (found) return;
      if (p.node.start === range.startOffset && p.node.end === range.endOffset) {
        found = p.node;
        p.stop();
      }
    },
  });
  return found;
}

function findFunctionByRange(ast: t.File, range: SourceRange): t.Function | null {
  let found: t.Function | null = null;
  traverse(ast, {
    Function(p: NodePath<t.Function>) {
      if (found) return;
      if (p.node.start === range.startOffset && p.node.end === range.endOffset) {
        found = p.node;
        p.stop();
      }
    },
  });
  return found;
}

function jsxAttrRawName(node: t.JSXAttribute): string {
  return t.isJSXIdentifier(node.name) ? node.name.name : `${node.name.namespace.name}:${node.name.name.name}`;
}

// ============================================================
// SET_INITIAL_STATE_LITERAL
// ============================================================

function applySetInitialStateLiteral(op: PatchOp, ctx: ApplyOpContext): ApplyOpResult {
  const source = getFile(ctx, op.file);
  const parsed = parseJsxFile(op.file, source);
  if (parsed.parseError) {
    throw err("E_PATCH_PARSE_ERROR", parsed.parseError.message, { file: op.file });
  }
  const stateName = String(op.params.stateName ?? "");
  let hook: UseStateHook | undefined;
  for (const c of parsed.components) {
    const h = c.useState.find((h) => h.getter === stateName);
    if (h) {
      hook = h;
      break;
    }
  }
  if (!hook) {
    throw err("E_TARGET_NOT_FOUND", `useState getter ${stateName} not found in ${op.file}`, { file: op.file });
  }
  const to = op.params.to;
  const toText = typeof to === "boolean" ? String(to) : JSON.stringify(to);
  const declText = source.slice(hook.range.startOffset, hook.range.endOffset);
  const newDeclText = declText.replace(/useState\(\s*[^)]*\)/, `useState(${toText})`);
  if (newDeclText === declText) {
    throw err("E_PATCH_PARSE_ERROR", "could not locate useState() call to rewrite", { file: op.file });
  }
  const newSource = source.slice(0, hook.range.startOffset) + newDeclText + source.slice(hook.range.endOffset);
  setFile(ctx, op.file, newSource);

  const reparsed = parseJsxFile(op.file, newSource);
  if (reparsed.parseError) {
    throw err("E_PATCH_PARSE_ERROR", reparsed.parseError.message, { file: op.file });
  }
  const newHook = reparsed.components.flatMap((c) => c.useState).find((h) => h.getter === stateName);
  if (!newHook || newHook.initialLiteral !== to) {
    throw err("E_PATCH_PARSE_ERROR", "postcondition failed: literal not updated", { file: op.file });
  }
  return { warnings: [] };
}

// ============================================================
// WIRE_CONTROLLED_CHECKBOX
// ============================================================

function applyWireControlledCheckbox(op: PatchOp, ctx: ApplyOpContext): ApplyOpResult {
  const warnings: WarningCode[] = [];
  const source = getFile(ctx, op.file);
  const parsed = parseJsxFile(op.file, source);
  if (parsed.parseError) {
    throw err("E_PATCH_PARSE_ERROR", parsed.parseError.message, { file: op.file });
  }
  const located = locateElement(parsed.components, ctx.finding.location);
  if (!located) {
    throw err("E_TARGET_NOT_FOUND", "checkbox element not found", { file: op.file });
  }
  const { element, component } = located;
  const stateName = String(op.params.stateName ?? "");
  const setterName = String(op.params.setterName ?? "");
  if (!stateName || !setterName) {
    throw err("E_BAD_INPUT", "stateName and setterName are required", { file: op.file });
  }

  const ast = parseRaw(source);
  const rawElement = findJsxElementByRange(ast, element.range);
  if (!rawElement) {
    throw err("E_TARGET_NOT_FOUND", "could not re-locate element for attribute edit", { file: op.file });
  }

  const edits: Edit[] = [];
  const attrs = rawElement.openingElement.attributes;
  const checkedAttrNode = attrs.find(
    (a): a is t.JSXAttribute =>
      t.isJSXAttribute(a) && (jsxAttrRawName(a) === "checked" || jsxAttrRawName(a) === "defaultChecked"),
  );
  const onChangeAttrNode = attrs.find((a): a is t.JSXAttribute => t.isJSXAttribute(a) && jsxAttrRawName(a) === "onChange");

  const newCheckedText = `checked={${stateName}}`;
  if (checkedAttrNode?.start != null && checkedAttrNode.end != null) {
    edits.push({ start: checkedAttrNode.start, end: checkedAttrNode.end, text: newCheckedText });
  } else {
    const tagEnd = rawElement.openingElement.name.end ?? rawElement.openingElement.start ?? 0;
    edits.push({ start: tagEnd, end: tagEnd, text: ` ${newCheckedText}` });
  }

  if (onChangeAttrNode) {
    warnings.push("ONCHANGE_EXISTS");
  } else {
    const onChangeText = ` onChange={(e) => ${setterName}(e.target.checked)}`;
    if (checkedAttrNode?.end != null) {
      edits.push({ start: checkedAttrNode.end, end: checkedAttrNode.end, text: onChangeText });
    } else {
      // merge into the same insertion point used for `checked` above to avoid
      // two zero-length edits at an identical offset.
      const last = edits[edits.length - 1];
      if (last) last.text += onChangeText;
    }
  }

  // hook declaration: after the last existing hook, else top of component body.
  if (component.useState.length > 0) {
    const lastHook = component.useState[component.useState.length - 1] as UseStateHook;
    edits.push({
      start: lastHook.range.endOffset,
      end: lastHook.range.endOffset,
      text: `\n  const [${stateName}, ${setterName}] = useState(false);`,
    });
  } else {
    const rawFn = findFunctionByRange(ast, component.range);
    if (!rawFn || !t.isBlockStatement(rawFn.body) || rawFn.body.start == null) {
      throw err("E_TARGET_NOT_FOUND", "component body not found for hook insertion", { file: op.file });
    }
    const insertAt = rawFn.body.start + 1;
    edits.push({
      start: insertAt,
      end: insertAt,
      text: `\n  const [${stateName}, ${setterName}] = useState(false);`,
    });
  }

  const hasUseStateImport = component.imports.some((i) => i.source === "react" && i.specifiers.includes("useState"));
  if (!hasUseStateImport) {
    edits.push({ start: 0, end: 0, text: `import { useState } from "react";\n` });
  }

  const newSource = applyEdits(source, edits);
  setFile(ctx, op.file, newSource);

  const reparsed = parseJsxFile(op.file, newSource);
  if (reparsed.parseError) {
    throw err("E_PATCH_PARSE_ERROR", reparsed.parseError.message, { file: op.file });
  }
  if (!newSource.includes(newCheckedText)) {
    throw err("E_PATCH_PARSE_ERROR", "postcondition failed: checked attribute not present", { file: op.file });
  }
  return { warnings };
}

// ============================================================
// SET_CSS_DECLARATION (stylesheet rule)
// ============================================================

function insertPosBeforeClosingBrace(source: string, rule: postcss.Rule): number {
  const endOffset = rule.source?.end?.offset;
  if (endOffset == null) {
    throw err("E_PATCH_PARSE_ERROR", "rule has no resolvable end offset");
  }
  // postcss's end offset is exclusive, pointing just past the rule's closing
  // '}'. Walk back to find that brace defensively.
  let i = endOffset - 1;
  while (i > 0 && source[i] !== "}") i--;
  return i;
}

function applySetCssDeclarationStylesheet(op: PatchOp, ctx: ApplyOpContext): ApplyOpResult {
  const source = getFile(ctx, op.file);
  const selector = String(op.target.selector ?? op.params.selector ?? "");
  const property = String(op.params.property ?? "");
  const value = String(op.params.value ?? "");
  if (!CSS_PROPERTY_ALLOWLIST.has(property)) {
    throw err("E_PROPERTY_NOT_ALLOWED", `property ${property} is not in the allowlist`, { file: op.file });
  }
  let root: postcss.Root;
  try {
    root = postcss.parse(source, { from: op.file });
  } catch (cause) {
    throw err("E_PATCH_PARSE_ERROR", cause instanceof Error ? cause.message : String(cause), { file: op.file });
  }

  let targetRule: postcss.Rule | undefined;
  root.walkRules((r) => {
    if (targetRule) return;
    if (r.selector.trim() === selector.trim()) targetRule = r;
  });
  if (!targetRule) {
    throw err("E_TARGET_NOT_FOUND", `selector "${selector}" not found in ${op.file}`, { file: op.file, selector });
  }

  let targetDecl: postcss.Declaration | undefined;
  targetRule.walkDecls((d) => {
    if (!targetDecl && d.prop === property) targetDecl = d;
  });

  let newSource: string;
  if (targetDecl?.source?.start?.offset != null && targetDecl.source.end?.offset != null) {
    const start = targetDecl.source.start.offset;
    const end = targetDecl.source.end.offset; // exclusive, includes trailing ';'
    const replacement = `${property}: ${value};`;
    newSource = source.slice(0, start) + replacement + source.slice(end);
  } else {
    const insertPos = insertPosBeforeClosingBrace(source, targetRule);
    const before = source.slice(0, insertPos);
    const needsLeadingSpace = !/[\s{]$/.test(before);
    const insertText = `${needsLeadingSpace ? " " : ""}${property}: ${value}; `;
    newSource = source.slice(0, insertPos) + insertText + source.slice(insertPos);
  }

  setFile(ctx, op.file, newSource);
  const reparsed = parseCssFile(op.file, newSource);
  if (reparsed.parseError) {
    throw err("E_PATCH_PARSE_ERROR", reparsed.parseError.message, { file: op.file });
  }
  const rule = reparsed.model.rules.find((r) => r.selector.trim() === selector.trim());
  const decl = rule?.declarations.find((d) => d.property === property);
  if (!decl || decl.value.trim() !== value.trim()) {
    throw err("E_PATCH_PARSE_ERROR", "postcondition failed: declaration not present with expected value", {
      file: op.file,
      property,
      value,
    });
  }
  return { warnings: [] };
}

// ---------- SET_CSS_DECLARATION (inline style fallback) ----------

function camelCase(property: string): string {
  return property.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function applySetCssDeclarationInline(op: PatchOp, ctx: ApplyOpContext): ApplyOpResult {
  const source = getFile(ctx, op.file);
  const parsed = parseJsxFile(op.file, source);
  if (parsed.parseError) {
    throw err("E_PATCH_PARSE_ERROR", parsed.parseError.message, { file: op.file });
  }
  const located = locateElement(parsed.components, ctx.finding.location);
  if (!located) {
    throw err("E_TARGET_NOT_FOUND", "inline style target element not found", { file: op.file });
  }
  const { element } = located;
  const ast = parseRaw(source);
  const rawEl = findJsxElementByRange(ast, element.range);
  if (!rawEl) {
    throw err("E_TARGET_NOT_FOUND", "element not found in raw AST", { file: op.file });
  }
  const property = String(op.params.property ?? "");
  const value = String(op.params.value ?? "");
  if (!CSS_PROPERTY_ALLOWLIST.has(property)) {
    throw err("E_PROPERTY_NOT_ALLOWED", `property ${property} is not in the allowlist`, { file: op.file });
  }
  const camel = camelCase(property);
  const jsValue = /^-?\d+(\.\d+)?$/.test(value) ? value : JSON.stringify(value);

  const styleAttr = rawEl.openingElement.attributes.find(
    (a): a is t.JSXAttribute => t.isJSXAttribute(a) && jsxAttrRawName(a) === "style",
  );

  let newSource: string;
  if (
    styleAttr?.value &&
    t.isJSXExpressionContainer(styleAttr.value) &&
    t.isObjectExpression(styleAttr.value.expression) &&
    styleAttr.start != null &&
    styleAttr.end != null
  ) {
    const objExpr = styleAttr.value.expression;
    const objStart = objExpr.start ?? 0;
    const objEnd = objExpr.end ?? 0;
    const existingProp = objExpr.properties.find(
      (p): p is t.ObjectProperty => t.isObjectProperty(p) && t.isIdentifier(p.key) && p.key.name === camel,
    );
    let newObjSource: string;
    if (existingProp && existingProp.start != null && existingProp.end != null) {
      const before = source.slice(objStart + 1, existingProp.start);
      const after = source.slice(existingProp.end, objEnd - 1);
      newObjSource = `{${before}${camel}: ${jsValue}${after}}`;
    } else {
      const inner = source.slice(objStart + 1, objEnd - 1);
      const sep = inner.trim().length > 0 ? ", " : "";
      newObjSource = `{${inner}${sep}${camel}: ${jsValue}}`;
    }
    const newAttrText = `style={${newObjSource}}`;
    newSource = source.slice(0, styleAttr.start) + newAttrText + source.slice(styleAttr.end);
  } else {
    const tagEnd = rawEl.openingElement.name.end ?? 0;
    const insertText = ` style={{ ${camel}: ${jsValue} }}`;
    newSource = source.slice(0, tagEnd) + insertText + source.slice(tagEnd);
  }

  setFile(ctx, op.file, newSource);
  const reparsed = parseJsxFile(op.file, newSource);
  if (reparsed.parseError) {
    throw err("E_PATCH_PARSE_ERROR", reparsed.parseError.message, { file: op.file });
  }
  if (!newSource.includes(`${camel}: ${jsValue}`)) {
    throw err("E_PATCH_PARSE_ERROR", "postcondition failed: inline style declaration not present", { file: op.file });
  }
  return { warnings: [] };
}

function applySetCssDeclaration(op: PatchOp, ctx: ApplyOpContext): ApplyOpResult {
  return op.file.endsWith(".css") ? applySetCssDeclarationStylesheet(op, ctx) : applySetCssDeclarationInline(op, ctx);
}

// ============================================================
// REMOVE_CSS_IMPORTANT
// ============================================================

function applyRemoveCssImportant(op: PatchOp, ctx: ApplyOpContext): ApplyOpResult {
  const source = getFile(ctx, op.file);
  const selector = String(op.target.selector ?? op.params.selector ?? "");
  const property = String(op.params.property ?? "");
  let root: postcss.Root;
  try {
    root = postcss.parse(source, { from: op.file });
  } catch (cause) {
    throw err("E_PATCH_PARSE_ERROR", cause instanceof Error ? cause.message : String(cause), { file: op.file });
  }
  let targetRule: postcss.Rule | undefined;
  root.walkRules((r) => {
    if (targetRule) return;
    if (r.selector.trim() === selector.trim()) targetRule = r;
  });
  if (!targetRule) {
    throw err("E_TARGET_NOT_FOUND", `selector "${selector}" not found in ${op.file}`, { file: op.file, selector });
  }
  let targetDecl: postcss.Declaration | undefined;
  targetRule.walkDecls((d) => {
    if (!targetDecl && d.prop === property) targetDecl = d;
  });
  if (!targetDecl?.source?.start?.offset && targetDecl?.source?.start?.offset !== 0) {
    throw err("E_TARGET_NOT_FOUND", `declaration ${property} not found in rule "${selector}"`, {
      file: op.file,
      selector,
      property,
    });
  }
  const start = targetDecl.source.start.offset;
  const end = targetDecl.source.end?.offset;
  if (end == null) {
    throw err("E_PATCH_PARSE_ERROR", "declaration has no resolvable end offset", { file: op.file });
  }
  const declText = source.slice(start, end);
  const newDeclText = declText.replace(/\s*!important/i, "");
  const newSource = source.slice(0, start) + newDeclText + source.slice(end);
  setFile(ctx, op.file, newSource);

  const reparsed = parseCssFile(op.file, newSource);
  if (reparsed.parseError) {
    throw err("E_PATCH_PARSE_ERROR", reparsed.parseError.message, { file: op.file });
  }
  const rule = reparsed.model.rules.find((r) => r.selector.trim() === selector.trim());
  const decl = rule?.declarations.find((d) => d.property === property);
  if (!decl || decl.important) {
    throw err("E_PATCH_PARSE_ERROR", "postcondition failed: !important still present", { file: op.file, property });
  }
  return { warnings: [] };
}

// ============================================================
// REMOVE_JSX_ELEMENT
// ============================================================

function applyRemoveJsxElement(op: PatchOp, ctx: ApplyOpContext): ApplyOpResult {
  const source = getFile(ctx, op.file);
  const parsed = parseJsxFile(op.file, source);
  if (parsed.parseError) {
    throw err("E_PATCH_PARSE_ERROR", parsed.parseError.message, { file: op.file });
  }
  const located = locateElement(parsed.components, ctx.finding.location);
  if (!located) {
    throw err("E_TARGET_NOT_FOUND", "element to remove not found", { file: op.file });
  }
  const { element } = located;
  const newSource = source.slice(0, element.range.startOffset) + source.slice(element.range.endOffset);
  setFile(ctx, op.file, newSource);

  const reparsed = parseJsxFile(op.file, newSource);
  if (reparsed.parseError) {
    throw err("E_PATCH_PARSE_ERROR", reparsed.parseError.message, { file: op.file });
  }
  return { warnings: [] };
}

// ============================================================
// INSERT_FEE_DISCLOSURE
// ============================================================

function findFirstPriceElement(root: JsxElementNode, currencySymbols: string[]): JsxElementNode | null {
  function hasCurrency(el: JsxElementNode): boolean {
    return el.textChildren.some((text) => currencySymbols.some((sym) => text.includes(sym)));
  }
  function walk(el: JsxElementNode): JsxElementNode | null {
    if (hasCurrency(el)) return el;
    for (const c of el.children) {
      const r = walk(c);
      if (r) return r;
    }
    return null;
  }
  return walk(root);
}

function relativeImportPath(fromFile: string, toFile: string): string {
  const fromDir = path.posix.dirname(fromFile);
  const toNoExt = toFile.replace(/\.(tsx|ts|jsx|js)$/, "");
  let rel = path.posix.relative(fromDir, toNoExt);
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

function applyInsertFeeDisclosure(op: PatchOp, ctx: ApplyOpContext): ApplyOpResult {
  const constKey = String(op.params.constKey ?? "");
  const label = String(op.params.label ?? "");
  if (!/^[a-zA-Z ]{3,40}$/.test(label)) {
    throw err("E_BAD_INPUT", "FeeDisclosure label failed validation ^[a-zA-Z ]{3,40}$", { label });
  }
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(constKey)) {
    throw err("E_BAD_INPUT", "FeeDisclosure constKey is not a valid identifier", { constKey });
  }

  if (!ctx.files.has(FEE_DISCLOSURE_PATH)) {
    const content = FEE_DISCLOSURE_TEMPLATE(constKey, label);
    setFile(ctx, FEE_DISCLOSURE_PATH, content);
    ctx.createdFiles.add(FEE_DISCLOSURE_PATH);
    const reparsed = parseJsxFile(FEE_DISCLOSURE_PATH, content);
    if (reparsed.parseError) {
      throw err("E_PATCH_PARSE_ERROR", reparsed.parseError.message, { file: FEE_DISCLOSURE_PATH });
    }
  }

  const stepFile = op.file;
  let source = getFile(ctx, stepFile);
  const parsed = parseJsxFile(stepFile, source);
  if (parsed.parseError) {
    throw err("E_PATCH_PARSE_ERROR", parsed.parseError.message, { file: stepFile });
  }

  const importPath = relativeImportPath(stepFile, FEE_DISCLOSURE_PATH);
  const importRe = new RegExp(`from\\s+["']${importPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
  const hasImport = importRe.test(source) || parsed.components.some((c) =>
    c.imports.some((i) => i.source === importPath),
  );

  const component = parsed.components.find((c) => c.jsxRoot);
  if (!component?.jsxRoot) {
    throw err("E_TARGET_NOT_FOUND", `no component with a JSX root found in ${stepFile}`, { file: stepFile });
  }
  const priceEl = findFirstPriceElement(component.jsxRoot, ctx.config.currency);
  if (!priceEl) {
    throw err("E_TARGET_NOT_FOUND", `no price element found to insert FeeDisclosure after in ${stepFile}`, {
      file: stepFile,
    });
  }

  const edits: Edit[] = [];
  if (!hasImport) {
    edits.push({ start: 0, end: 0, text: `import FeeDisclosure from "${importPath}";\n` });
  }
  edits.push({
    start: priceEl.range.endOffset,
    end: priceEl.range.endOffset,
    text: `\n      <FeeDisclosure />`,
  });

  source = applyEdits(source, edits);
  setFile(ctx, stepFile, source);

  const reparsed = parseJsxFile(stepFile, source);
  if (reparsed.parseError) {
    throw err("E_PATCH_PARSE_ERROR", reparsed.parseError.message, { file: stepFile });
  }
  if (!source.includes("<FeeDisclosure")) {
    throw err("E_PATCH_PARSE_ERROR", "postcondition failed: FeeDisclosure not referenced", { file: stepFile });
  }
  return { warnings: [] };
}

// ============================================================
// REPLACE_JSX_TEXT
// ============================================================

function applyReplaceJsxText(op: PatchOp, ctx: ApplyOpContext): ApplyOpResult {
  const source = getFile(ctx, op.file);
  const parsed = parseJsxFile(op.file, source);
  if (parsed.parseError) {
    throw err("E_PATCH_PARSE_ERROR", parsed.parseError.message, { file: op.file });
  }
  const located = locateElement(parsed.components, ctx.finding.location);
  if (!located) {
    throw err("E_TARGET_NOT_FOUND", "text element not found", { file: op.file });
  }
  const { element } = located;
  const to = String(op.params.to ?? "");
  const ast = parseRaw(source);
  const rawEl = findJsxElementByRange(ast, element.range);
  if (!rawEl) {
    throw err("E_TARGET_NOT_FOUND", "element not found in raw AST", { file: op.file });
  }
  const textChildren = rawEl.children.filter(
    (c): c is t.JSXText => t.isJSXText(c) && c.value.trim().length > 0,
  );
  if (textChildren.length === 0) {
    throw err("E_TARGET_NOT_FOUND", "no text node found to replace", { file: op.file });
  }
  const first = textChildren[0] as t.JSXText;
  const last = textChildren[textChildren.length - 1] as t.JSXText;
  if (first.start == null || last.end == null) {
    throw err("E_PATCH_PARSE_ERROR", "text node has no resolvable range", { file: op.file });
  }
  const newSource = source.slice(0, first.start) + to + source.slice(last.end);
  setFile(ctx, op.file, newSource);

  const reparsed = parseJsxFile(op.file, newSource);
  if (reparsed.parseError) {
    throw err("E_PATCH_PARSE_ERROR", reparsed.parseError.message, { file: op.file });
  }
  if (!newSource.includes(to)) {
    throw err("E_PATCH_PARSE_ERROR", "postcondition failed: text not replaced", { file: op.file });
  }
  return { warnings: [] };
}

// ============================================================
// dispatcher
// ============================================================

export function applyOp(op: PatchOp, ctx: ApplyOpContext): ApplyOpResult {
  switch (op.kind) {
    case "SET_INITIAL_STATE_LITERAL":
      return applySetInitialStateLiteral(op, ctx);
    case "WIRE_CONTROLLED_CHECKBOX":
      return applyWireControlledCheckbox(op, ctx);
    case "SET_CSS_DECLARATION":
      return applySetCssDeclaration(op, ctx);
    case "REMOVE_CSS_IMPORTANT":
      return applyRemoveCssImportant(op, ctx);
    case "REMOVE_JSX_ELEMENT":
      return applyRemoveJsxElement(op, ctx);
    case "INSERT_FEE_DISCLOSURE":
      return applyInsertFeeDisclosure(op, ctx);
    case "REPLACE_JSX_TEXT":
      return applyReplaceJsxText(op, ctx);
    default:
      throw err("E_OP_NOT_ALLOWED", `Unknown op kind: ${String(op.kind)}`);
  }
}
