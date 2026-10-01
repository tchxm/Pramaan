// Normalized model produced by parser/jsx.ts and parser/css.ts.
// Authoritative shape — consumed by style/cascade.ts, detectors/*, patch/*, verify/*.
// Spec: PRAMAAN_MASTER_SPEC.md Section 9.2.

export interface JsxAttribute {
  name: string;
  /** Literal string/number/boolean value when statically known. */
  literalValue?: string | number | boolean | null;
  /** Raw source text of the attribute's expression when not a simple literal. */
  expressionSource?: string;
  /** True when the attribute has no value, e.g. bare `checked`. */
  isBare: boolean;
}

export interface SourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export interface JsxElementNode {
  id: string; // stable within-file id, assigned during parse (depth-first index path)
  tag: string; // lowercase for host elements, as-written for components
  attributes: JsxAttribute[];
  textChildren: string[]; // normalised (whitespace collapsed) direct text children
  children: JsxElementNode[];
  parent: JsxElementNode | null;
  range: SourceRange;
  /** dot-joined child indexes from the component's returned JSX root to this element. */
  jsxPath: string;
}

export interface UseStateHook {
  getter: string;
  setter: string;
  initialLiteral?: string | number | boolean | null;
  initialExpressionSource?: string;
  range: SourceRange;
}

export interface UseEffectBlock {
  bodySource: string;
  range: SourceRange;
  /** identifiers referenced inside that resolve to setInterval/setTimeout calls. */
  hasIntervalOrTimeout: boolean;
}

export interface ComponentModel {
  name: string; // enclosing function/class name, or "<anonymous>"
  range: SourceRange;
  useState: UseStateHook[];
  useEffects: UseEffectBlock[];
  jsxRoot: JsxElementNode | null; // root of the returned JSX tree, if any
  imports: { source: string; specifiers: string[] }[];
}

export interface FileModel {
  path: string; // POSIX-relative to workspace root
  sha256: string;
  source: string;
  components: ComponentModel[];
  parseError?: { message: string };
}

export interface CssDeclarationNode {
  property: string;
  value: string;
  important: boolean;
  line: number;
  column: number;
}

export interface CssRuleNode {
  selector: string;
  declarations: CssDeclarationNode[];
  line: number;
  sourceOrder: number;
  /** Name of the enclosing at-rule (e.g. "media", "supports") when this rule
   * is nested inside one. Undefined for a top-level rule. Spec 9.4: contents
   * of @media/@supports are not resolved by the static cascade; cascade.ts
   * uses this to emit UNSUPPORTED_STYLE_SOURCE and skip the rule. */
  unsupportedAtRule?: string;
}

export interface CssFileModel {
  path: string;
  sha256: string;
  rules: CssRuleNode[];
  rootVars: Record<string, string>; // custom properties declared on :root
}

export interface ProjectModel {
  srcRoot: string;
  files: FileModel[];
  cssFiles: CssFileModel[];
  warnings: { code: string; message: string; file?: string }[];
}
