// JSX/TSX parsing — Spec Section 9.2.
// Parses a single source file with @babel/parser and builds a ComponentModel[]
// per the locked shapes in parser/model.ts. Pure function: no I/O here, the
// caller supplies the source text (see discover.ts / index buildProjectModel).

import { parse } from "@babel/parser";
import * as traverseNs from "@babel/traverse";
import type { NodePath, TraverseOptions } from "@babel/traverse";
import * as t from "@babel/types";
import type {
  ComponentModel,
  JsxAttribute,
  JsxElementNode,
  SourceRange,
  UseEffectBlock,
  UseStateHook,
} from "./model.js";

// @babel/traverse's CJS module sets both `module.exports = traverse` and
// `exports.default = traverse`. Node's CJS->ESM interop then wraps the whole
// CJS exports object as `ns.default`, so the real function is nested two
// levels deep (`ns.default.default`) under plain `node`/NodeNext ESM — one
// level under some transform-based runners (vitest/ts-node), which is why a
// single-level unwrap works in tests but throws "not callable" at runtime.
// Unwrap however many `.default` layers are actually present.
type TraverseFn = (ast: t.Node, visitor: TraverseOptions) => void;
function unwrapTraverse(mod: unknown): TraverseFn {
  let candidate = mod;
  for (let i = 0; i < 3 && typeof candidate !== "function"; i++) {
    const withDefault = candidate as { default?: unknown };
    if (!withDefault || typeof withDefault.default === "undefined") break;
    candidate = withDefault.default;
  }
  if (typeof candidate !== "function") {
    throw new TypeError("Could not resolve @babel/traverse's default export");
  }
  return candidate as TraverseFn;
}
const traverse: TraverseFn = unwrapTraverse(traverseNs);

export interface JsxParseResult {
  components: ComponentModel[];
  parseError?: { message: string };
}

const INTERVAL_TIMEOUT_NAMES = new Set(["setInterval", "setTimeout"]);

function rangeOf(node: t.Node, source: string): SourceRange {
  const loc = node.loc;
  const startOffset = node.start ?? 0;
  const endOffset = node.end ?? 0;
  if (!loc) {
    return { startLine: 1, startColumn: 0, endLine: 1, endColumn: 0, startOffset, endOffset };
  }
  return {
    startLine: loc.start.line,
    startColumn: loc.start.column,
    endLine: loc.end.line,
    endColumn: loc.end.column,
    startOffset,
    endOffset,
  };
}

function normaliseText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function sourceSliceOf(node: t.Node, source: string): string {
  const start = node.start ?? 0;
  const end = node.end ?? 0;
  return source.slice(start, end);
}

function literalOf(node: t.Node): string | number | boolean | null | undefined {
  if (t.isStringLiteral(node)) return node.value;
  if (t.isNumericLiteral(node)) return node.value;
  if (t.isBooleanLiteral(node)) return node.value;
  if (t.isNullLiteral(node)) return null;
  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return node.quasis.map((q) => q.value.cooked ?? "").join("");
  }
  if (t.isUnaryExpression(node) && node.operator === "-" && t.isNumericLiteral(node.argument)) {
    return -node.argument.value;
  }
  return undefined;
}

function jsxAttrName(node: t.JSXAttribute): string {
  if (t.isJSXIdentifier(node.name)) return node.name.name;
  // namespaced name e.g. xml:lang
  return `${node.name.namespace.name}:${node.name.name.name}`;
}

function buildAttribute(attr: t.JSXAttribute, source: string): JsxAttribute {
  const name = jsxAttrName(attr);
  if (attr.value === null || attr.value === undefined) {
    return { name, isBare: true };
  }
  if (t.isStringLiteral(attr.value)) {
    return { name, literalValue: attr.value.value, isBare: false };
  }
  if (t.isJSXExpressionContainer(attr.value)) {
    const expr = attr.value.expression;
    if (t.isJSXEmptyExpression(expr)) {
      return { name, isBare: false, expressionSource: "" };
    }
    const lit = literalOf(expr);
    if (lit !== undefined) {
      return { name, literalValue: lit, isBare: false };
    }
    return { name, isBare: false, expressionSource: sourceSliceOf(expr, source) };
  }
  return { name, isBare: false, expressionSource: sourceSliceOf(attr.value, source) };
}

function tagNameOf(node: t.JSXElement): string {
  const name = node.openingElement.name;
  return jsxNameToString(name);
}

function jsxNameToString(
  name: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName,
): string {
  if (t.isJSXIdentifier(name)) return name.name;
  if (t.isJSXNamespacedName(name)) return `${name.namespace.name}:${name.name.name}`;
  return `${jsxNameToString(name.object)}.${name.property.name}`;
}

/** Builds the normalized element tree for a single JSX root, assigning jsxPath
 * as dot-joined child indexes from that root. */
function buildElementTree(
  node: t.JSXElement | t.JSXFragment,
  source: string,
  parent: JsxElementNode | null,
  pathSegments: number[],
): JsxElementNode | null {
  if (t.isJSXFragment(node)) {
    // Fragments are not elements themselves; represent as a synthetic "<>"
    // container so children still get stable jsxPaths relative to the root.
    const synthetic: JsxElementNode = {
      id: pathSegments.join("."),
      tag: "<>",
      attributes: [],
      textChildren: [],
      children: [],
      parent,
      range: rangeOf(node, source),
      jsxPath: pathSegments.join("."),
    };
    populateChildren(node.children, source, synthetic, pathSegments);
    return synthetic;
  }

  const attributes: JsxAttribute[] = [];
  for (const attr of node.openingElement.attributes) {
    if (t.isJSXAttribute(attr)) {
      attributes.push(buildAttribute(attr, source));
    }
    // JSXSpreadAttribute: intentionally not modeled (no literal value, not
    // a named attribute) — spec covers literal attributes only.
  }

  const element: JsxElementNode = {
    id: pathSegments.join("."),
    tag: tagNameOf(node),
    attributes,
    textChildren: [],
    children: [],
    parent,
    range: rangeOf(node, source),
    jsxPath: pathSegments.join("."),
  };

  populateChildren(node.children, source, element, pathSegments);
  return element;
}

function populateChildren(
  children: t.JSXElement["children"],
  source: string,
  parentModel: JsxElementNode,
  parentPath: number[],
): void {
  let childIndex = 0;
  for (const child of children) {
    if (t.isJSXText(child)) {
      const text = normaliseText(child.value);
      if (text.length > 0) parentModel.textChildren.push(text);
      continue;
    }
    if (t.isJSXExpressionContainer(child)) {
      if (t.isJSXEmptyExpression(child.expression)) continue;
      const lit = literalOf(child.expression);
      if (typeof lit === "string" || typeof lit === "number") {
        const text = normaliseText(String(lit));
        if (text.length > 0) parentModel.textChildren.push(text);
      }
      // Non-literal expressions are not walked into further elements here;
      // they may themselves be JSX (conditional rendering) but are not
      // statically guaranteed to render, so we do not synthesize paths for
      // them. This is a documented limitation, not a silent pass: detectors
      // operate on what is statically known.
      continue;
    }
    if (t.isJSXElement(child) || t.isJSXFragment(child)) {
      const childPath = [...parentPath, childIndex];
      const childModel = buildElementTree(child, source, parentModel, childPath);
      if (childModel) parentModel.children.push(childModel);
      childIndex += 1;
      continue;
    }
    if (t.isJSXSpreadChild(child)) {
      // Not modeled; spread children carry no static text/element info.
      continue;
    }
  }
}

function findReturnedJsxRoot(fnNode: t.Node): t.JSXElement | t.JSXFragment | null {
  let found: t.JSXElement | t.JSXFragment | null = null;

  function visitReturnArg(arg: t.Expression | null | undefined): void {
    if (!arg || found) return;
    if (t.isJSXElement(arg) || t.isJSXFragment(arg)) {
      found = arg;
      return;
    }
    if (t.isParenthesizedExpression(arg)) {
      visitReturnArg(arg.expression);
    }
  }

  if (t.isArrowFunctionExpression(fnNode) && (t.isJSXElement(fnNode.body) || t.isJSXFragment(fnNode.body))) {
    return fnNode.body;
  }

  const body = t.isArrowFunctionExpression(fnNode) || t.isFunctionExpression(fnNode) || t.isFunctionDeclaration(fnNode)
    ? fnNode.body
    : null;
  if (body && t.isBlockStatement(body)) {
    for (const stmt of body.body) {
      if (t.isReturnStatement(stmt)) {
        visitReturnArg(stmt.argument);
        if (found) break;
      }
    }
  }
  return found;
}

function componentNameOf(path: NodePath<t.Function>): string {
  const node = path.node;
  if ((t.isFunctionDeclaration(node) || t.isFunctionExpression(node)) && node.id) {
    return node.id.name;
  }
  // arrow/function expression assigned to a variable: const Foo = () => ...
  const parent = path.parent;
  if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
    return parent.id.name;
  }
  return "<anonymous>";
}

function extractUseState(
  path: NodePath<t.Function>,
  source: string,
): UseStateHook[] {
  const hooks: UseStateHook[] = [];
  path.get("body").traverse({
    VariableDeclarator(declPath) {
      const node = declPath.node;
      if (!t.isCallExpression(node.init)) return;
      const callee = node.init.callee;
      const calleeName = t.isIdentifier(callee) ? callee.name : undefined;
      if (calleeName !== "useState") return;
      if (!t.isArrayPattern(node.id)) return;
      const [getterEl, setterEl] = node.id.elements;
      if (!getterEl || !t.isIdentifier(getterEl)) return;
      if (!setterEl || !t.isIdentifier(setterEl)) return;
      const arg = node.init.arguments[0];
      let initialLiteral: UseStateHook["initialLiteral"];
      let initialExpressionSource: string | undefined;
      if (arg && (t.isExpression(arg))) {
        const lit = literalOf(arg);
        if (lit !== undefined) {
          initialLiteral = lit;
        } else {
          initialExpressionSource = sourceSliceOf(arg, source);
        }
      }
      hooks.push({
        getter: getterEl.name,
        setter: setterEl.name,
        initialLiteral,
        initialExpressionSource,
        range: rangeOf(node, source),
      });
    },
  });
  return hooks;
}

function callReferencesIntervalOrTimeout(node: t.Node): boolean {
  let found = false;
  function walk(n: t.Node | null | undefined): void {
    if (!n || found) return;
    if (t.isCallExpression(n)) {
      const callee = n.callee;
      if (t.isIdentifier(callee) && INTERVAL_TIMEOUT_NAMES.has(callee.name)) {
        found = true;
        return;
      }
    }
    for (const key of Object.keys(n)) {
      if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
      const value = (n as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object" && "type" in item) walk(item as t.Node);
        }
      } else if (value && typeof value === "object" && "type" in value) {
        walk(value as t.Node);
      }
    }
  }
  walk(node);
  return found;
}

function extractUseEffects(path: NodePath<t.Function>, source: string): UseEffectBlock[] {
  const effects: UseEffectBlock[] = [];
  path.get("body").traverse({
    CallExpression(callPath) {
      const callee = callPath.node.callee;
      if (!t.isIdentifier(callee) || callee.name !== "useEffect") return;
      const [cb] = callPath.node.arguments;
      if (!cb || !(t.isArrowFunctionExpression(cb) || t.isFunctionExpression(cb))) return;
      effects.push({
        bodySource: sourceSliceOf(cb.body, source),
        range: rangeOf(callPath.node, source),
        hasIntervalOrTimeout: callReferencesIntervalOrTimeout(cb.body),
      });
    },
  });
  return effects;
}

function extractImports(ast: t.File): ComponentModel["imports"] {
  const imports: ComponentModel["imports"] = [];
  for (const stmt of ast.program.body) {
    if (t.isImportDeclaration(stmt)) {
      const specifiers = stmt.specifiers.map((s) => {
        if (t.isImportDefaultSpecifier(s)) return "default";
        if (t.isImportNamespaceSpecifier(s)) return "*";
        return t.isIdentifier(s.imported) ? s.imported.name : s.imported.value;
      });
      imports.push({ source: stmt.source.value, specifiers });
    }
  }
  return imports;
}

function isComponentCandidate(path: NodePath<t.Function>): boolean {
  const node = path.node;
  // Name heuristic: PascalCase function whose name (or assigned var name)
  // starts with an uppercase letter — the JSX-root check below is the real
  // gate, this just avoids walking every helper function twice.
  if (t.isFunctionDeclaration(node) && node.id) {
    return /^[A-Z]/.test(node.id.name);
  }
  const parent = path.parent;
  if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
    return /^[A-Z]/.test(parent.id.name);
  }
  return false;
}

export function parseJsxFile(filePath: string, source: string): JsxParseResult {
  let ast: t.File;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
      errorRecovery: false,
    });
  } catch (cause) {
    return {
      components: [],
      parseError: { message: cause instanceof Error ? cause.message : String(cause) },
    };
  }

  const imports = extractImports(ast);
  const components: ComponentModel[] = [];

  traverse(ast, {
    Function(path) {
      if (!isComponentCandidate(path)) return;
      const jsxRootNode = findReturnedJsxRoot(path.node);
      const name = componentNameOf(path);
      const jsxRoot = jsxRootNode ? buildElementTree(jsxRootNode, source, null, []) : null;
      components.push({
        name,
        range: rangeOf(path.node, source),
        useState: extractUseState(path, source),
        useEffects: extractUseEffects(path, source),
        jsxRoot,
        imports,
      });
    },
  });

  return { components };
}
