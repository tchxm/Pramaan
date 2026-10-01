// Accept/reject clickable-element discovery shared by PRM-003 (Interface
// Interference, spec 10.3) and PRM-005 (Confirm Shaming candidates, spec
// 10.5, which explicitly reuses "10.3 discovery, extended to any element
// whose text matches the reject set").

import type { PramaanConfig } from "../config.js";
import type { JsxElementNode } from "../parser/model.js";
import { elementText, findAttr } from "./util.js";

export const REJECT_RE = /no thanks|no, thanks|decline|skip|cancel|not now|maybe later|remove|reject|no$/i;
export const ACCEPT_RE = /yes|continue|purchase|buy|add|subscribe|accept|agree|keep|complete|protect|get/i;

export type ClickRole = "accept" | "reject" | null;

export function isClickable(el: JsxElementNode, config: PramaanConfig): boolean {
  if (el.tag === "button") return true;
  if (el.tag === "a") {
    const role = findAttr(el, "role");
    const href = findAttr(el, "href");
    return role?.literalValue === "button" || href !== undefined;
  }
  return config.buttonComponents.includes(el.tag);
}

/** Classifies by normalised text, reject checked first (spec lists reject
 * set first and several fixtures' reject text also contains accept-set
 * words, e.g. "no thanks" is not "yes/accept/..."; but words like "protect"
 * appear as accept-set members and could coincidentally appear in longer
 * reject sentences, so reject is authoritative when both match). */
export function classify(text: string): ClickRole {
  const norm = text.toLowerCase();
  if (REJECT_RE.test(norm)) return "reject";
  if (ACCEPT_RE.test(norm)) return "accept";
  return null;
}

export interface ClickableCandidate {
  el: JsxElementNode;
  role: ClickRole;
  text: string;
}

export function collectClickables(root: JsxElementNode, config: PramaanConfig): ClickableCandidate[] {
  const out: ClickableCandidate[] = [];
  function walk(el: JsxElementNode): void {
    if (isClickable(el, config)) {
      const text = elementText(el);
      out.push({ el, role: classify(text), text });
    }
    for (const c of el.children) walk(c);
  }
  walk(root);
  return out;
}

export interface AcceptRejectPair {
  accept: ClickableCandidate;
  reject: ClickableCandidate;
}

/** Pairs within the same JSX parent or grandparent (spec 10.3). Multiple
 * pairs per parent are allowed; dedupe by element identity pair. */
export function findPairs(root: JsxElementNode, config: PramaanConfig): AcceptRejectPair[] {
  const clickables = collectClickables(root, config);
  const pairs: AcceptRejectPair[] = [];
  const seen = new Set<string>();
  for (const a of clickables) {
    if (a.role !== "accept") continue;
    for (const r of clickables) {
      if (r.role !== "reject") continue;
      const sameParent = a.el.parent === r.el.parent;
      const grandA = a.el.parent?.parent ?? null;
      const grandR = r.el.parent?.parent ?? null;
      const sameGrandparent = grandA !== null && grandA === grandR;
      if (!sameParent && !sameGrandparent) continue;
      const key = `${a.el.id}|${r.el.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ accept: a, reject: r });
    }
  }
  return pairs;
}
