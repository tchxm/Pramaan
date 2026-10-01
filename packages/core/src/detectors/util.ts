// Shared helpers for the PRM-001..004 detectors. Internal to detectors/** —
// not part of the package's public API surface (not re-exported from
// src/index.ts) unless a specific symbol is explicitly needed elsewhere.
//
// No I/O here: everything operates on the already-loaded ProjectModel.

import type { Evidence, Signal } from "../types.js";
import type { ComponentModel, FileModel, JsxElementNode, SourceRange } from "../parser/model.js";

export interface DetectorWarning {
  code: string;
  message: string;
  file?: string;
}

/** Depth-first walk of every JSX element in every component of a file. */
export function* walkFileElements(
  file: FileModel,
): Generator<{ component: ComponentModel; el: JsxElementNode }> {
  for (const component of file.components) {
    if (!component.jsxRoot) continue;
    function* walk(el: JsxElementNode): Generator<JsxElementNode> {
      yield el;
      for (const c of el.children) yield* walk(c);
    }
    for (const el of walk(component.jsxRoot)) {
      yield { component, el };
    }
  }
}

/** Own text + all descendant text, depth-first (mirrors parser/label.ts's
 * private collectText — duplicated here since that helper isn't exported;
 * see KNOWN RISKS). */
export function elementText(el: JsxElementNode): string {
  const parts: string[] = [...el.textChildren];
  for (const child of el.children) {
    const t = elementText(child);
    if (t) parts.push(t);
  }
  return normalise(parts.join(" "));
}

export function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Raw source text of an element's range, from the enclosing file's full
 * source. Used where the locked JSX model does not structurally capture
 * non-literal expression children (e.g. `{FEES.handling}`, `{mm}:{ss}`,
 * ternaries) — see KNOWN RISKS "raw-source fallback". */
export function rawSlice(file: FileModel, range: SourceRange): string {
  return file.source.slice(range.startOffset, range.endOffset);
}

/** sourceSnippet per spec 8: <= 12 lines around the finding. */
export function sourceSnippet(file: FileModel, range: SourceRange): string {
  const lines = file.source.split("\n");
  const start = Math.max(0, range.startLine - 3);
  const end = Math.min(lines.length, start + 12);
  return lines.slice(start, end).join("\n");
}

export function findAttr(el: JsxElementNode, name: string): { literalValue?: unknown; expressionSource?: string; isBare: boolean } | undefined {
  return el.attributes.find((a) => a.name === name);
}

export function buildEvidence(opts: {
  file: FileModel;
  range: SourceRange;
  observed: Record<string, string | number | boolean | null>;
  warnings?: string[];
  cascade?: Evidence["cascade"];
}): Evidence {
  return {
    sourceSnippet: sourceSnippet(opts.file, opts.range),
    fileSha256: opts.file.sha256,
    observed: opts.observed,
    ...(opts.cascade ? { cascade: opts.cascade } : {}),
    warnings: opts.warnings ?? [],
  };
}

export function signal(id: string, fired: boolean, weight: number, observed: Signal["observed"] = {}): Signal {
  return { id, fired, weight, observed };
}

/** Sort key used everywhere findings must be ordered: file path, then line,
 * then column (spec Section 10 preamble / Section 8). */
export function locationSortKey(loc: { file: string; startLine: number; startColumn: number }): string {
  return `${loc.file}\u0000${String(loc.startLine).padStart(10, "0")}\u0000${String(loc.startColumn).padStart(10, "0")}`;
}
