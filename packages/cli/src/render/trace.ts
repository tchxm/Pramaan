// Terminal rendering for trace events during `pramaan audit`. Spec 16.4:
// one line per event of type agent.tool_call / policy.reject /
// approval.requested / patch.applied / verify.result, prefixed by actor.
// VERIFIED/FAILED/STATIC_VERIFIED are printed ONLY from verify.result events.
import type { TraceEvent } from "@pramaan/core";
import { green, amber, red, dim } from "./colors.js";

const PRINTED_TYPES = new Set([
  "agent.tool_call",
  "policy.reject",
  "approval.requested",
  "patch.applied",
  "verify.result",
]);

function verdictWord(verdict: string): string {
  if (verdict === "VERIFIED") return green(verdict);
  if (verdict === "STATIC_VERIFIED") return amber(verdict);
  if (verdict === "FAILED") return red(verdict);
  return verdict;
}

export function renderTraceLine(event: TraceEvent): string | undefined {
  if (!PRINTED_TYPES.has(event.type)) return undefined;
  const prefix = `${event.actor}:`;
  switch (event.type) {
    case "verify.result": {
      const verdict = String(event.payload.verdict ?? "");
      const findingId = String(event.payload.findingId ?? "");
      return `${prefix} ${findingId} ${verdictWord(verdict)}`;
    }
    case "agent.tool_call":
      return `${prefix} tool_call ${dim(String(event.payload.tool ?? ""))}`;
    case "policy.reject":
      return `${prefix} policy reject ${dim(String(event.payload.code ?? ""))} ${String(event.payload.message ?? "")}`;
    case "approval.requested":
      return `${prefix} approval requested for ${String(event.payload.findingId ?? event.payload.approvalId ?? "")}`;
    case "patch.applied":
      return `${prefix} patch applied (${Array.isArray(event.payload.filesWritten) ? (event.payload.filesWritten as unknown[]).length : "?"} files)`;
    default:
      return undefined;
  }
}
