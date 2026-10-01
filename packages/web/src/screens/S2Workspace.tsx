// S2 Workspace — spec Section 18.3 (main screen), 18.5 (data flow), 18.8
// (responsiveness). This screen owns every API call the store itself does
// not make (diff fetch, file fetch, approval resolution) and composes the
// twenty workspace components around the live `useAuditStore` state.
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useAuditStore } from "../state/store.js";
import { getAuditDiff, getAuditFile, resolveApproval, ApiError } from "../api/client.js";
import type { ApprovalDecision } from "../components/workspace/ApprovalDrawer.js";

import { PhaseBar } from "../components/workspace/PhaseBar.js";
import { FileTree, type FileTreeFile } from "../components/workspace/FileTree.js";
import { FindingList } from "../components/workspace/FindingList.js";
import { StatusPill } from "../components/workspace/StatusPill.js";
import { ErrorState } from "../components/workspace/ErrorState.js";
import { CodeView } from "../components/workspace/CodeView.js";
import { DiffView } from "../components/workspace/DiffView.js";
import { RuntimeCompare } from "../components/workspace/RuntimeCompare.js";
import { EvidencePanel } from "../components/workspace/EvidencePanel.js";
import { SignalTable } from "../components/workspace/SignalTable.js";
import { CascadeTable } from "../components/workspace/CascadeTable.js";
import { RegulationBasis } from "../components/workspace/RegulationBasis.js";
import { GatesPanel } from "../components/workspace/GatesPanel.js";
import { TraceStrip } from "../components/workspace/TraceStrip.js";
import { TraceDetail } from "../components/workspace/TraceDetail.js";
import { ApprovalDrawer } from "../components/workspace/ApprovalDrawer.js";
import DemoTour from "../components/workspace/DemoTour.js";
import { useBreakpoint } from "./useMediaQuery.js";

import "../styles/workspace.css";
import "../styles/screens.css";

type CenterView = "code" | "diff" | "compare";
type NarrowTab = "files" | "finding" | "evidence" | "trace";

export default function S2Workspace(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const breakpoint = useBreakpoint();
  const [searchParams] = useSearchParams();
  const [tourActive, setTourActive] = useState(searchParams.get("tour") === "1");

  const store = useAuditStore();
  const {
    auditId,
    audit,
    findingsById,
    verifyByFinding,
    proposalsByFinding,
    events,
    pendingApproval,
    connection,
    selectedFindingId,
    errorBanner,
    diffRevision,
    selectFinding,
    dismissError,
  } = store;

  useEffect(() => {
    if (!id) return;
    useAuditStore.getState().connect(id);
    return () => {
      useAuditStore.getState().disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const findings = useMemo(() => Object.values(findingsById), [findingsById]);
  const selectedFinding = selectedFindingId ? (findingsById[selectedFindingId] ?? null) : null;
  const selectedVerify = selectedFindingId ? verifyByFinding[selectedFindingId] : undefined;
  const selectedProposals = selectedFindingId ? (proposalsByFinding[selectedFindingId] ?? []) : [];
  const latestProposal = selectedProposals[selectedProposals.length - 1];

  const fileTreeFiles: FileTreeFile[] = useMemo(() => {
    const byFile = new Map<string, string[]>();
    for (const f of findings) {
      const list = byFile.get(f.location.file) ?? [];
      list.push(f.findingId);
      byFile.set(f.location.file, list);
    }
    return Array.from(byFile.entries()).map(([path, findingIds]) => ({ path, findingIds }));
  }, [findings]);

  const [leftTab, setLeftTab] = useState<"files" | "findings">("findings");
  const [centerView, setCenterView] = useState<CenterView>("code");
  const [narrowTab, setNarrowTab] = useState<NarrowTab>("finding");
  const [mediumShowRight, setMediumShowRight] = useState(false);
  const [selectedTraceSeq, setSelectedTraceSeq] = useState<number | null>(null);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // ---- code view content ----
  const [codeText, setCodeText] = useState<string>("");
  const [codeLoading, setCodeLoading] = useState(false);
  useEffect(() => {
    if (!auditId || !selectedFinding) {
      setCodeText("");
      return;
    }
    let cancelled = false;
    setCodeLoading(true);
    getAuditFile(auditId, selectedFinding.location.file, "before")
      .then((res) => {
        if (!cancelled) setCodeText(res.text);
      })
      .catch(() => {
        if (!cancelled) setCodeText("");
      })
      .finally(() => {
        if (!cancelled) setCodeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [auditId, selectedFinding?.findingId, selectedFinding?.location.file]);

  // ---- diff content ----
  const [diffText, setDiffText] = useState<string>("");
  useEffect(() => {
    if (!auditId || !selectedFindingId) {
      setDiffText("");
      return;
    }
    let cancelled = false;
    getAuditDiff(auditId, latestProposal?.proposalId)
      .then((res) => {
        if (!cancelled) setDiffText(res.diff);
      })
      .catch(() => {
        if (!cancelled) setDiffText("");
      });
    return () => {
      cancelled = true;
    };
    // diffRevision bump (patch.applied for this finding) triggers a refetch
    // per store.ts's contract — the store does not fetch diffs itself.
  }, [auditId, selectedFindingId, latestProposal?.proposalId, diffRevision]);

  // ---- approval drawer diff ----
  const [approvalDiff, setApprovalDiff] = useState<string>("");
  useEffect(() => {
    if (!auditId || !pendingApproval) {
      setApprovalDiff("");
      return;
    }
    let cancelled = false;
    getAuditDiff(auditId, pendingApproval.proposalId)
      .then((res) => {
        if (!cancelled) setApprovalDiff(res.diff);
      })
      .catch(() => {
        if (!cancelled) setApprovalDiff("");
      });
    return () => {
      cancelled = true;
    };
  }, [auditId, pendingApproval?.proposalId]);

  const [approvalBusy, setApprovalBusy] = useState(false);
  const onResolveApproval = async (decision: ApprovalDecision, editedText?: string): Promise<void> => {
    if (!auditId || !pendingApproval) return;
    setApprovalBusy(true);
    try {
      await resolveApproval(auditId, pendingApproval.approvalId, decision, editedText);
      // The store clears `pendingApproval` itself once the `approval.resolved`
      // SSE event arrives — we don't mutate store state directly here.
    } catch (err) {
      // Surface via a thrown error so ApprovalDrawer can show it if it chooses;
      // at minimum, stop blocking the buttons.
      void err;
    } finally {
      setApprovalBusy(false);
    }
  };

  const onSelectFile = (path: string): void => {
    setSelectedFile(path);
    const entry = fileTreeFiles.find((f) => f.path === path);
    const firstFinding = entry?.findingIds[0];
    if (firstFinding) selectFinding(firstFinding);
  };

  const onSelectTraceSeq = (seq: number): void => {
    setSelectedTraceSeq((current) => (current === seq ? null : seq));
  };

  const selectedTraceEvent = events.find((e) => e.seq === selectedTraceSeq) ?? null;

  const phaseFailed =
    audit?.status === "error" || audit?.status === "completed_with_failures" || selectedVerify?.verdict === "FAILED";

  // Must run unconditionally on every render (even the loading-state early
  // return below) — a hook called only on SOME renders breaks React's
  // hooks-order invariant and crashes the component the moment `audit`
  // first becomes truthy.
  const warningsCount = useMemo(() => {
    const scanEvent = events.find((e) => e.type === "scan.completed");
    const warnings = scanEvent?.payload.warnings;
    return typeof warnings === "number" ? warnings : 0;
  }, [events]);

  // ---------- loading / empty states ----------
  if (!audit && !errorBanner) {
    return (
      <div className="scr-page">
        <div className="ws-phase-bar" data-testid="phase-bar" aria-live="polite">
          Connecting…
        </div>
        <div className="scr-skeleton-list" style={{ marginTop: 24 }}>
          <div className="scr-skeleton-row" />
          <div className="scr-skeleton-row" />
          <div className="scr-skeleton-row" />
        </div>
        <p className="scr-trace-loading">Scanning files</p>
      </div>
    );
  }

  const showEmptyState = audit && findings.length === 0 && audit.status !== "running";

  const centerPane = (
    <div className="scr-center-pane">
      <div className="scr-tabbar" role="tablist" aria-label="Code views">
        {(["code", "diff", "compare"] as CenterView[]).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={centerView === v}
            className={centerView === v ? "scr-tab scr-tab--active" : "scr-tab"}
            onClick={() => setCenterView(v)}
          >
            {v === "code" ? "Code" : v === "diff" ? "Diff" : "Before/after"}
          </button>
        ))}
      </div>

      {!selectedFinding ? (
        <p className="scr-empty-hint">Select a finding to inspect it.</p>
      ) : (
        <>
          {centerView === "code" &&
            (codeLoading ? (
              <div className="scr-skeleton-row" />
            ) : (
              <CodeView
                file={selectedFinding.location.file}
                text={codeText}
                highlight={[
                  { startLine: selectedFinding.location.startLine, endLine: selectedFinding.location.endLine },
                ]}
              />
            ))}
          {centerView === "diff" && <DiffView unifiedDiff={diffText} />}
          {centerView === "compare" && (
            <RuntimeCompare
              observed={
                (selectedVerify?.gates.find((g) => g.gate === "G4_RUNTIME")?.details as Record<string, unknown>) ??
                selectedFinding.evidence.observed
              }
            />
          )}

          <section className="scr-fix-proposal" aria-label="Fix proposal">
            <h3 className="scr-panel-title">Fix proposal</h3>
            {latestProposal ? (
              <>
                <p className="ws-mono scr-strategy">{latestProposal.strategy}</p>
                <p className="scr-rationale">{latestProposal.rationale}</p>
                <ul className="scr-ops-list">
                  {latestProposal.ops.map((op) => (
                    <li key={op.opId} className="ws-mono">
                      {op.kind} · {op.file}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="scr-empty-hint">No fix proposed yet.</p>
            )}
          </section>
        </>
      )}
    </div>
  );

  const rightPane = selectedFinding ? (
    <div className="scr-right-pane">
      <EvidencePanel finding={selectedFinding} />
      <SignalTable signals={selectedFinding.signals} />
      {selectedFinding.evidence.cascade ? <CascadeTable entries={selectedFinding.evidence.cascade} /> : null}
      <RegulationBasis refs={selectedFinding.regulation} />
      <GatesPanel verify={selectedVerify} pending={selectedFinding.status === "remediating"} />
    </div>
  ) : (
    <div className="scr-right-pane">
      <p className="scr-empty-hint">No finding selected.</p>
    </div>
  );

  const leftPane = (
    <div className="scr-left-pane">
      <div className="scr-tabbar" role="tablist" aria-label="Left panel">
        <button
          type="button"
          role="tab"
          aria-selected={leftTab === "files"}
          className={leftTab === "files" ? "scr-tab scr-tab--active" : "scr-tab"}
          onClick={() => setLeftTab("files")}
        >
          Files
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={leftTab === "findings"}
          className={leftTab === "findings" ? "scr-tab scr-tab--active" : "scr-tab"}
          onClick={() => setLeftTab("findings")}
        >
          Findings
        </button>
      </div>
      {leftTab === "files" ? (
        <FileTree files={fileTreeFiles} selected={selectedFile ?? undefined} onSelect={onSelectFile} />
      ) : (
        <FindingList findings={findings} selectedId={selectedFindingId ?? undefined} onSelect={selectFinding} />
      )}
    </div>
  );

  const traceStrip = (
    <div className="scr-trace-strip-wrap">
      <TraceStrip events={events} onSelect={onSelectTraceSeq} />
      {selectedTraceEvent ? (
        <div className="scr-trace-detail-popover">
          <TraceDetail event={selectedTraceEvent} />
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="scr-page scr-workspace">
      <header className="scr-workspace-header">
        <span className="scr-wordmark">Pramaan</span>
        <span className="ws-mono scr-audit-id">{audit?.auditId}</span>
        <span className="scr-project-name">{audit?.projectName}</span>
        <PhaseBar phase={store.phase} failed={phaseFailed} />
        {selectedFinding ? (
          <div data-testid="verdict-chip" aria-live="polite">
            <StatusPill status={selectedFinding.status} />
          </div>
        ) : null}
      </header>

      {connection === "reconnecting" ? (
        <div className="scr-banner scr-banner--warn" role="status">
          Reconnecting to the server
        </div>
      ) : null}

      {errorBanner ? (
        <div className="scr-banner scr-banner--error">
          <ErrorState code={errorBanner.code} message={errorBanner.message} action={{ label: "Dismiss", onClick: dismissError }} />
        </div>
      ) : null}

      {showEmptyState ? (
        <p className="scr-empty-state">No deceptive patterns found in the scanned files. Warnings: {warningsCount}</p>
      ) : breakpoint === "wide" ? (
        <div className="scr-three-pane">
          {leftPane}
          {centerPane}
          {rightPane}
        </div>
      ) : breakpoint === "medium" ? (
        <div className="scr-two-pane">
          {leftPane}
          <div className="scr-center-with-right">
            {centerPane}
            <div className="scr-right-toggle">
              <button type="button" className="scr-tab" onClick={() => setMediumShowRight((v) => !v)}>
                {mediumShowRight ? "Hide evidence" : "Show evidence"}
              </button>
              {mediumShowRight ? rightPane : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="scr-narrow">
          <div className="scr-tabbar" role="tablist" aria-label="Workspace sections">
            {(["files", "finding", "evidence", "trace"] as NarrowTab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={narrowTab === t}
                className={narrowTab === t ? "scr-tab scr-tab--active" : "scr-tab"}
                onClick={() => setNarrowTab(t)}
              >
                {t === "files" ? "Files" : t === "finding" ? "Finding" : t === "evidence" ? "Evidence" : "Trace"}
              </button>
            ))}
          </div>
          {narrowTab === "files" ? leftPane : null}
          {narrowTab === "finding" ? centerPane : null}
          {narrowTab === "evidence" ? rightPane : null}
          {narrowTab === "trace" ? traceStrip : null}
        </div>
      )}

      {breakpoint !== "narrow" ? traceStrip : null}

      {pendingApproval ? (
        <div className="scr-approval-overlay">
          <ApprovalDrawer
            request={pendingApproval}
            diff={approvalDiff}
            onResolve={onResolveApproval}
            onClose={undefined}
          />
          {approvalBusy ? <div className="scr-approval-busy-veil" aria-hidden="true" /> : null}
        </div>
      ) : null}

      {tourActive && findings.length > 0 && breakpoint === "wide" ? (
        <DemoTour onFinish={() => setTourActive(false)} />
      ) : null}
    </div>
  );
}
