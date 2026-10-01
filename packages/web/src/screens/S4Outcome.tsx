// S4 Outcome — spec Section 18.3. The one memorable moment: a large
// "before -> after" count and a gate matrix that fills in from real
// `verify.result` events, plus three actions gated on the audit actually
// being completed. No fabricated counters: everything here reads straight
// from `useAuditStore`.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuditStore } from "../state/store.js";
import { applyAudit, getEvidencePack, reportUrl, evidenceUrl, ApiError } from "../api/client.js";
import { usePrefersReducedMotion } from "./useMediaQuery.js";
import { OutcomeHero } from "../components/workspace/OutcomeHero.js";
import { GateMatrix } from "../components/workspace/GateMatrix.js";
import { ProofBlock } from "../components/workspace/ProofBlock.js";
import AppShell from "../components/shell/AppShell.js";
import GateGuide from "../components/workspace/GateGuide.js";
import "../styles/workspace.css";
import "../styles/screens.css";

export default function S4Outcome(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const store = useAuditStore();
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!id) return;
    // Reuse an already-connected stream for the same audit (e.g. navigating
    // here from S2); only reconnect on a fresh navigation or reload.
    if (useAuditStore.getState().auditId !== id || useAuditStore.getState().connection === "closed") {
      useAuditStore.getState().connect(id);
    }
    return () => {
      // Intentionally does not disconnect: the audit may still be streaming
      // and the user may navigate back to S2. The store's own `connect`
      // tears down the previous subscription when a different id connects.
    };
  }, [id]);

  const findings = useMemo(() => Object.values(store.findingsById), [store.findingsById]);
  const before = store.audit?.before.total ?? 0;
  const after = store.audit?.after?.total ?? findings.filter(f => !["verified", "static_verified", "ignored"].includes(f.status)).length;
  const checkedFixes = findings.filter(f => store.verifyByFinding[f.findingId]?.verdict === "VERIFIED").length;
  const proposalStops = findings.filter(f => !!store.proposalsByFinding[f.findingId]?.length && !store.events.some(e => e.type === "patch.applied" && e.payload.findingId === f.findingId && (e.payload.result as { applied?: boolean })?.applied)).length;
  const reviewOnly = findings.filter(f => f.status === "failed" && !store.proposalsByFinding[f.findingId]?.length).length;

  const [traceHead, setTraceHead] = useState("");
  useEffect(() => {
    let active = true;
    setTraceHead("");
    if (id && store.audit?.evidenceHash) {
      void getEvidencePack(id).then(pack => { if (active) setTraceHead(pack.traceHead); }).catch(() => {});
    }
    return () => { active = false; };
  }, [id, store.audit?.evidenceHash]);

  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<string[] | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const isCompleted = store.audit?.status === "completed" || store.audit?.status === "completed_with_failures";

  const onOpenReport = (): void => {
    if (!id) return;
    window.open(reportUrl(id), "_blank", "noopener,noreferrer");
  };

  const onDownloadPack = async (): Promise<void> => {
    if (!id) return;
    setDownloadError(null);
    try {
      const pack = await getEvidencePack(id);
      const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${id}-evidence-pack.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(err instanceof ApiError ? err.message : "Could not download the evidence pack.");
    }
  };

  const changedFiles = useMemo(() => {
    const files = new Set<string>();
    for (const event of store.events) {
      const result = event.payload.result as { applied?: boolean; filesChanged?: string[] } | undefined;
      if (event.type === "patch.applied" && result?.applied) {
        for (const file of result.filesChanged ?? []) files.add(file);
      }
    }
    return Array.from(files);
  }, [store.events]);
  const uncheckedPatch = store.events.some(event => event.type === "patch.applied" &&
    (event.payload.result as { applied?: boolean } | undefined)?.applied &&
    !findings.some(finding => finding.findingId === event.payload.findingId && ["verified", "static_verified"].includes(finding.status)));

  const onApply = async (): Promise<void> => {
    if (!id) return;
    const confirmed = window.confirm(
      `Write ${changedFiles.length} changed files to your project? The original files will be overwritten.`,
    );
    if (!confirmed) return;
    setApplyBusy(true);
    setApplyError(null);
    try {
      const res = await applyAudit(id);
      setApplyResult(res.filesWritten);
    } catch (err) {
      setApplyError(err instanceof ApiError ? err.message : "Could not apply changes.");
    } finally {
      setApplyBusy(false);
    }
  };

  if (!store.audit) {
    return (
      <div className="scr-page scr-page--center">
        <div className="scr-skeleton-list">
          <div className="scr-skeleton-row" />
          <div className="scr-skeleton-row" />
        </div>
      </div>
    );
  }

  return (
    <div className="scr-page scr-outcome">
      <AppShell status={isCompleted ? "EVIDENCE READY" : "AUDIT RUNNING"} />
      <header className="scr-outcome-header">
        <span className="ws-mono scr-audit-id">{store.audit.auditId}</span>
        <span className="scr-project-name">{store.audit.projectName}</span>
      </header>

      <OutcomeHero before={before} after={after} reduceMotion={reduceMotion} />

      <section className="judge-summary" aria-label="Audit result summary"><h2>{checkedFixes ? "A checked fix. An honest stopping point." : "What the engine established."}</h2><div className="judge-summary__counts"><span><b>{before}</b>findings detected</span><span><b>{checkedFixes}</b>verified fixes</span><span><b>{proposalStops}</b>proposals not applied</span><span><b>{reviewOnly}</b>review stops without proposals</span></div><p>The engine’s verification applies to the individual fix. {after ? `${after} findings remain unresolved; the project has not been declared clear.` : "No unresolved findings remain within the supported detector rules."} Download the evidence to inspect the actual proposals, results and checks.</p></section>

      <GateGuide />

      <GateMatrix findings={findings} verifyByFinding={store.verifyByFinding} />

      {id ? (
        <ProofBlock
          auditId={id}
          evidenceHash={store.audit.evidenceHash ?? ""}
          traceHead={traceHead}
          reportUrl={reportUrl(id)}
          packUrl={evidenceUrl(id)}
        />
      ) : null}

      {isCompleted ? (
        <div className="scr-outcome-actions">
          <button type="button" className="scr-secondary-btn" onClick={onOpenReport}>
            Open evidence report
          </button>
          <button type="button" className="scr-secondary-btn" onClick={() => void onDownloadPack()}>
            Download evidence pack
          </button>
          <button
            type="button"
            className="scr-primary-btn"
            data-testid="apply-btn"
            disabled={applyBusy || changedFiles.length === 0 || uncheckedPatch}
            onClick={() => void onApply()}
          >
            {applyBusy ? "Applying…" : "Apply changes to project"}
          </button>
          {downloadError ? <p className="scr-inline-error">{downloadError}</p> : null}
          {applyError ? <p className="scr-inline-error">{applyError}</p> : null}
          {applyResult ? <p className="scr-inline-success">Wrote {applyResult.length} files.</p> : null}
        </div>
      ) : (
        <p className="scr-empty-hint">Actions appear once the audit has completed.</p>
      )}
    </div>
  );
}
