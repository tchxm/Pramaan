import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { TraceEvent } from "../types/core";
import type { SseHandlers } from "../api/sse.js";
const captured = vi.hoisted(() => ({ handlers: null as SseHandlers | null }));
vi.mock("../api/sse.js", () => ({ subscribeToAuditEvents: (_url: string, handlers: SseHandlers) => {
  captured.handlers = handlers; return () => {};
} }));
import { useAuditStore } from "./store.js";
const record = JSON.parse(readFileSync(new URL("../../public/demo/mitti-mart.json", import.meta.url), "utf8"));
const event = (type: TraceEvent["type"], payload: Record<string, unknown>, seq = 1): TraceEvent => ({
  type, payload, seq, actor: "engine", ts: record.recordedAt, prevHash: "", hash: "",
});
beforeEach(() => {
  useAuditStore.getState().disconnect();
  useAuditStore.getState().connect("recorded-demo-test");
  captured.handlers!.onSnapshot({ audit: { findings: record.findings }, findings: record.findings, pendingApprovals: [] });
});
describe("real agent event payloads", () => {
  it("reads nested engine verdicts and restores the corresponding gate results", () => {
    captured.handlers!.onTraceEvent(event("verify.result", { findingId: record.verification.findingId, result: record.verification }));
    const state = useAuditStore.getState();
    expect(state.findingsById[record.verification.findingId]?.status).toBe("verified");
    expect(state.verifyByFinding[record.verification.findingId]?.gates).toEqual(record.verification.gates);
  });
  it("shows successful proposal tool results and never treats a rejected patch as applied", () => {
    captured.handlers!.onTraceEvent(event("tool.result", { name: "patch.propose", result: { ok: true, data: record.proposal } }));
    captured.handlers!.onTraceEvent(event("patch.applied", { findingId: record.proposal.findingId, result: { applied: false } }, 2));
    const state = useAuditStore.getState();
    expect(state.proposalsByFinding[record.proposal.findingId]).toEqual([record.proposal]);
    expect(state.findingsById[record.proposal.findingId]?.status).toBe("open");
    expect(state.diffRevision).toBe(0);
  });
});
