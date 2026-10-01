// S4 Outcome — spec Section 18.3. The one memorable moment: a large
// "before -> after" count and a gate matrix that fills in from real
// `verify.result` events, plus three actions gated on the audit actually
// being completed. No fabricated counters: everything here reads straight
// from `useAuditStore`.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuditStore } from "../state/store.js";
import { applyAudit, getEvidencePack, reportUrl, ApiError } from "../api/client.js";
import { usePrefersReducedMotion } from "./useMediaQuery.js";
import { OutcomeHero } from "../components/workspace/OutcomeHero.js";
import { GateMatrix } from "../components/workspace/GateMatrix.js";
import { ProofBlock } from "../components/workspace/ProofBlock.js";
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
    if (useAuditStore.getState().auditId !== id) {
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
  const after = store.audit?.after?.total ?? 0;

  const lastEvent = store.events.length > 0 ? store.events[store.events.length - 1] : undefined;
  const traceHead = lastEvent?.hash ?? "";

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
    for (const list of Object.values(store.proposalsByFinding)) {
      for (const p of list) {
        for (const op of p.ops) files.add(op.file);
      }
    }
    return Array.from(files);
  }, [store.proposalsByFinding]);

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
      <header className="scr-outcome-header">
        <span className="scr-wordmark">Pramaan</span>
        <span className="ws-mono scr-audit-id">{store.audit.auditId}</span>
        <span className="scr-project-name">{store.audit.projectName}</span>
      </header>

      <OutcomeHero before={before} after={after} reduceMotion={reduceMotion} />

      <GateMatrix findings={findings} verifyByFinding={store.verifyByFinding} />

      {id ? (
        <ProofBlock
          auditId={id}
          evidenceHash={store.audit.evidenceHash ?? ""}
          traceHead={traceHead}
          reportUrl={reportUrl(id)}
          packUrl={reportUrl(id)}
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
            disabled={applyBusy || changedFiles.length === 0}
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
