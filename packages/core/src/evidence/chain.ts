import { createHash } from "node:crypto";
import type { TraceEvent } from "../types.js";
import { canonicalJson } from "./canonical.js";

export const GENESIS_HASH = "0".repeat(64);

/**
 * hash_i = sha256(prevHash_i + canonicalJSON(event_i without prevHash and hash))
 * Spec Section 15.4.
 */
export function computeEventHash(event: Omit<TraceEvent, "hash">): string {
  const { prevHash, ...rest } = event;
  return createHash("sha256").update(prevHash + canonicalJson(rest)).digest("hex");
}

export function appendEvent(
  chainTail: string,
  event: Omit<TraceEvent, "prevHash" | "hash">,
): TraceEvent {
  const withPrev = { ...event, prevHash: chainTail };
  const hash = computeEventHash(withPrev);
  return { ...withPrev, hash };
}

export interface ChainCheckResult {
  valid: boolean;
  brokenAtSeq?: number;
}

export function verifyChain(events: TraceEvent[]): ChainCheckResult {
  let prev = GENESIS_HASH;
  for (const event of events) {
    if (event.prevHash !== prev) {
      return { valid: false, brokenAtSeq: event.seq };
    }
    const { hash: _hash, ...withoutHash } = event;
    const expected = computeEventHash(withoutHash);
    if (expected !== event.hash) {
      return { valid: false, brokenAtSeq: event.seq };
    }
    prev = event.hash;
  }
  return { valid: true };
}
