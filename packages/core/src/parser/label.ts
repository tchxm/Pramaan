// Label association — Spec Section 9.3.
// For an <input>, the label text is, in order:
//   1. text of an enclosing <label>
//   2. text of a <label htmlFor=id> in the same component
//   3. aria-label literal
//   4. text of the immediately following sibling text node or <span>
// If none is found, LABEL_NOT_FOUND is recorded and the caller treats the
// input as "no label" (not commercial, per PRM-001).

import type { JsxElementNode } from "./model.js";

export type LabelMethod = "enclosing_label" | "label_for" | "aria_label" | "sibling_text";

export interface LabelResult {
  text: string | null;
  method: LabelMethod | null;
}

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Collects all direct + nested text of an element, in tree traversal order.
 * NOTE: the locked JsxElementNode shape stores textChildren and children as
 * separate arrays without interleave position, so exact DOM text order
 * across mixed text/element siblings cannot be reconstructed. We approximate
 * by emitting this element's own text first, then each child's text
 * depth-first. Documented limitation — see KNOWN RISKS. */
function collectText(el: JsxElementNode): string {
  const parts: string[] = [...el.textChildren];
  for (const child of el.children) {
    const childText = collectText(child);
    if (childText) parts.push(childText);
  }
  return normalise(parts.join(" "));
}

function findAttr(el: JsxElementNode, name: string): string | undefined {
  const attr = el.attributes.find((a) => a.name === name);
  if (!attr) return undefined;
  if (typeof attr.literalValue === "string") return attr.literalValue;
  return undefined;
}

function findAncestorLabel(input: JsxElementNode): JsxElementNode | null {
  let cur = input.parent;
  while (cur) {
    if (cur.tag === "label") return cur;
    cur = cur.parent;
  }
  return null;
}

function findLabelFor(root: JsxElementNode, id: string): JsxElementNode | null {
  let found: JsxElementNode | null = null;
  function walk(el: JsxElementNode): void {
    if (found) return;
    if (el.tag === "label" && findAttr(el, "htmlFor") === id) {
      found = el;
      return;
    }
    for (const c of el.children) walk(c);
  }
  walk(root);
  return found;
}

function findFollowingSiblingLabel(input: JsxElementNode): string | null {
  const parent = input.parent;
  if (!parent) return null;
  const idx = parent.children.indexOf(input);
  if (idx >= 0) {
    const next = parent.children[idx + 1];
    if (next && next.tag === "span") {
      const text = collectText(next);
      if (text) return text;
    }
  }
  // Fallback: sibling text nodes on the parent (see collectText note on
  // ordering limitations of the locked model).
  const text = normalise(parent.textChildren.join(" "));
  return text.length > 0 ? text : null;
}

/** Resolves the label for an <input> element per spec 9.3. `root` is the
 * jsxRoot of the enclosing component (needed for the htmlFor lookup, which
 * must search the whole component, not just ancestors). */
export function resolveLabel(input: JsxElementNode, root: JsxElementNode): LabelResult {
  const enclosing = findAncestorLabel(input);
  if (enclosing) {
    const text = collectText(enclosing);
    if (text) return { text, method: "enclosing_label" };
  }

  const id = findAttr(input, "id");
  if (id) {
    const labelFor = findLabelFor(root, id);
    if (labelFor) {
      const text = collectText(labelFor);
      if (text) return { text, method: "label_for" };
    }
  }

  const ariaLabel = findAttr(input, "aria-label");
  if (ariaLabel) {
    const text = normalise(ariaLabel);
    if (text) return { text, method: "aria_label" };
  }

  const siblingText = findFollowingSiblingLabel(input);
  if (siblingText) {
    return { text: siblingText, method: "sibling_text" };
  }

  return { text: null, method: null };
}
