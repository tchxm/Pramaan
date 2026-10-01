// Zustand store — Spec Section 18.5. This is the ONLY place SSE events are
// translated into UI state. The rules that matter most:
//   1. A finding's status changes ONLY from a `verify.result` event's
//      `payload.verdict` — never from `agent.reason` text, no matter what
//      it says. This is the UI-side half of invariant I-01.
//   2. On reconnect, events are merged by `seq`; duplicates are ignored.
//   3. A dropped connection never erases visible state — it shows a
//      "reconnecting" banner and keeps the last known data on screen.
import { create } from "zustand";
import type { Audit, Finding, VerifyResult, PatchProposal, ApprovalRequest, TraceEvent } from "@pramaan/core";
import { subscribeToAuditEvents, type AuditSnapshotPayload } from "../api/sse.js";
import { eventsUrl } from "../api/client.js";

export type ConnectionState = "connecting" | "live" | "reconnecting" | "closed";
export type WorkspacePhase = "scan" | "investigate" | "fix" | "verify" | "evidence" | "done";
export type WorkspaceView = "code" | "diff" | "compare";

const MAX_EVENTS = 1000;

export interface AuditStoreState {
  auditId: string | null;
  audit: Audit | null;
  findingsById: Record<string, Finding>;
  verifyByFinding: Record<string, VerifyResult>;
  proposalsByFinding: Record<string, PatchProposal[]>;
  events: TraceEvent[];
  pendingApproval: ApprovalRequest | null;
  connection: ConnectionState;
  selectedFindingId: string | null;
  view: WorkspaceView;
  phase: WorkspacePhase;
  errorBanner: { code: string; message: string } | null;
  /** Bumped whenever a `patch.applied` event lands for the selected finding,
   * so a DiffView component can react (re-fetch) without the store itself
   * owning API calls. */
  diffRevision: number;

  connect: (auditId: string) => void;
  disconnect: () => void;
  selectFinding: (findingId: string | null) => void;
  setView: (view: WorkspaceView) => void;
  dismissError: () => void;
}

function findingStatusFromVerdict(verdict: VerifyResult["verdict"]): Finding["status"] {
  if (verdict === "VERIFIED") return "verified";
  if (verdict === "STATIC_VERIFIED") return "static_verified";
  return "failed";
}

function phaseForEvent(type: TraceEvent["type"], current: WorkspacePhase): WorkspacePhase {
  switch (type) {
    case "scan.completed":
      return "investigate";
    case "patch.applied":
      return "fix";
    case "verify.result":
      return "verify";
    case "evidence.generated":
      return "evidence";
    case "audit.completed":
      return "done";
    default:
      return current;
  }
}

let activeUnsubscribe: (() => void) | null = null;

export const useAuditStore = create<AuditStoreState>((set, get) => ({
  auditId: null,
  audit: null,
  findingsById: {},
  verifyByFinding: {},
  proposalsByFinding: {},
  events: [],
  pendingApproval: null,
  connection: "closed",
  selectedFindingId: null,
  view: "code",
  phase: "scan",
  errorBanner: null,
  diffRevision: 0,

  connect: (auditId: string) => {
    activeUnsubscribe?.();
    set({
      auditId,
      audit: null,
      findingsById: {},
      verifyByFinding: {},
      proposalsByFinding: {},
      events: [],
      pendingApproval: null,
      connection: "connecting",
      selectedFindingId: null,
      phase: "scan",
      errorBanner: null,
      diffRevision: 0,
    });

    activeUnsubscribe = subscribeToAuditEvents(eventsUrl(auditId), {
      onConnectionChange: (connection) => set({ connection }),

      onSnapshot: (payload: AuditSnapshotPayload) => {
        const audit = payload.audit as Audit;
        const findings = payload.findings as Finding[];
        const pendingApprovals = payload.pendingApprovals as ApprovalRequest[];
        const findingsById: Record<string, Finding> = {};
        for (const f of findings) findingsById[f.findingId] = f;
        set({
          audit,
          findingsById,
          pendingApproval: pendingApprovals[0] ?? null,
          selectedFindingId: get().selectedFindingId ?? findings[0]?.findingId ?? null,
        });
      },

      onTraceEvent: (event: TraceEvent) => {
        const state = get();

        // Dedup by seq — reconnect may replay events we already have.
        if (state.events.some((e) => e.seq === event.seq)) return;

        const events = [...state.events, event]
          .sort((a, b) => a.seq - b.seq)
          .slice(-MAX_EVENTS);

        const phase = phaseForEvent(event.type, state.phase);
        const patch: Partial<AuditStoreState> = { events, phase };

        switch (event.type) {
          case "patch.applied": {
            const payload = event.payload as { findingId?: string };
            if (payload.findingId) {
              const existing = state.findingsById[payload.findingId];
              if (existing) {
                patch.findingsById = {
                  ...state.findingsById,
                  [payload.findingId]: { ...existing, status: "remediating" },
                };
              }
              if (payload.findingId === state.selectedFindingId) {
                patch.diffRevision = state.diffRevision + 1;
              }
            }
            break;
          }

          case "verify.result": {
            // RULE: finding status changes ONLY here, from the structured
            // verdict — never from agent.reason text (I-01).
            const payload = event.payload as unknown as VerifyResult;
            const findingId = payload.findingId;
            if (findingId) {
              patch.verifyByFinding = { ...state.verifyByFinding, [findingId]: payload };
              const existing = state.findingsById[findingId];
              if (existing) {
                patch.findingsById = {
                  ...state.findingsById,
                  [findingId]: { ...existing, status: findingStatusFromVerdict(payload.verdict) },
                };
              }
            }
            break;
          }

          case "approval.requested": {
            const payload = event.payload as { approval?: ApprovalRequest };
            if (payload.approval) patch.pendingApproval = payload.approval;
            break;
          }

          case "approval.resolved": {
            patch.pendingApproval = null;
            break;
          }

          case "error": {
            const payload = event.payload as { code?: string; message?: string };
            patch.errorBanner = { code: payload.code ?? "E_INTERNAL", message: payload.message ?? "An error occurred." };
            break;
          }

          default:
            break;
        }

        set(patch);
      },
    });
  },

  disconnect: () => {
    activeUnsubscribe?.();
    activeUnsubscribe = null;
    set({ connection: "closed" });
  },

  selectFinding: (findingId) => set({ selectedFindingId: findingId }),
  setView: (view) => set({ view }),
  dismissError: () => set({ errorBanner: null }),
}));
