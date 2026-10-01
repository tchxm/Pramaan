import { useEffect, useRef, useState } from "react";
import type { ApprovalRequest } from "../../types/core";
import "../../styles/workspace.css";

export type ApprovalDecision = "approve" | "reject" | "edit" | "ignore";

export interface ApprovalDrawerProps {
  request: ApprovalRequest;
  diff: string;
  /**
   * Resolves a decision. For "edit", `editedText` carries the human's
   * adjusted proposed text (this matches resolveApproval's signature in
   * ../../api/client.ts: decision + optional editedText).
   */
  onResolve(decision: ApprovalDecision, editedText?: string): Promise<void>;
  /** Optional: what "close" (Escape) means to the caller. Not required —
   * the drawer is otherwise a controlled overlay driven by `request`. */
  onClose?: () => void;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DiffLine {
  kind: "add" | "del" | "context" | "meta";
  text: string;
}

/**
 * Minimal inline unified-diff renderer, deliberately duplicated here rather
 * than importing DiffView.tsx (owned by another engineer, may not exist at
 * build time yet). Only +/- line coloring — no word-level highlighting.
 */
function parseDiff(unifiedDiff: string): DiffLine[] {
  return unifiedDiff.split("\n").map((line) => {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@") || line.startsWith("diff ")) {
      return { kind: "meta", text: line };
    }
    if (line.startsWith("+")) return { kind: "add", text: line };
    if (line.startsWith("-")) return { kind: "del", text: line };
    return { kind: "context", text: line };
  });
}

/**
 * S3 Approval drawer — spec 18.3/18.4/18.8/14.9. Surfaces the human half of
 * the approval handshake: the engine suspends the agent loop, the server
 * mints the approval token on approve/edit (the agent never sees it), and
 * this component only ever calls onResolve with the human's decision.
 */
export function ApprovalDrawer({ request, diff, onResolve, onClose }: ApprovalDrawerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState(request.proposed);
  const [busy, setBusy] = useState<ApprovalDecision | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mirrors of state read inside the keydown handler below, which is bound
  // once per approvalId — refs avoid rebinding the listener on every
  // keystroke while keeping the "A" shortcut in sync with edit mode.
  const editingRef = useRef(editing);
  const editedTextRef = useRef(editedText);
  editingRef.current = editing;
  editedTextRef.current = editedText;

  useEffect(() => {
    setEditing(false);
    setEditedText(request.proposed);
    setError(null);
  }, [request.approvalId, request.proposed]);

  // Focus trap + Escape (spec 18.8: "drawer focus trap and Esc to close").
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const focusables = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const first = focusables()[0];
    first?.focus();

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
        return;
      }

      if (e.key === "Tab") {
        const items = focusables();
        if (items.length === 0) return;
        const firstEl = items[0]!;
        const lastEl = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
        return;
      }

      // A/E/R/I shortcuts (spec 18.3 S3) — only when focus is inside the
      // drawer and the human isn't currently typing in a text field.
      const target = e.target as HTMLElement | null;
      const isTyping = target?.tagName === "TEXTAREA" || target?.tagName === "INPUT";
      if (isTyping || e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toLowerCase();
      if (key === "a") {
        e.preventDefault();
        void handleDecision(editingRef.current ? "edit" : "approve", editingRef.current ? editedTextRef.current : undefined);
      } else if (key === "e") {
        e.preventDefault();
        setEditing(true);
      } else if (key === "r") {
        e.preventDefault();
        void handleDecision("reject");
      } else if (key === "i") {
        e.preventDefault();
        void handleDecision("ignore");
      }
    }

    container.addEventListener("keydown", handleKeyDown);
    return () => container.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.approvalId]);

  async function handleDecision(decision: ApprovalDecision, text?: string): Promise<void> {
    setBusy(decision);
    setError(null);
    try {
      await onResolve(decision, text);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record your decision. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const diffLines = parseDiff(diff);
  const isResolved = request.status !== "pending";

  return (
    <div className="ws-approval-overlay">
      <div
        ref={containerRef}
        className="ws-approval-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-drawer-title"
        data-testid="approval-drawer"
      >
        <h2 id="approval-drawer-title" className="ws-approval-drawer__title">
          Approve this change?
        </h2>

        {isResolved ? (
          <p className="ws-approval-drawer__expired" role="alert">
            This approval expired. Restart the audit to continue.
          </p>
        ) : null}

        <section className="ws-approval-drawer__section">
          <h3>Reason</h3>
          <p>{request.reason}</p>
        </section>

        <section className="ws-approval-drawer__section">
          <h3>Original</h3>
          <pre className="ws-approval-drawer__text ws-mono">{request.original}</pre>
        </section>

        <section className="ws-approval-drawer__section">
          <h3>Proposed</h3>
          {editing ? (
            <textarea
              className="ws-approval-drawer__edit"
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              rows={4}
              aria-label="Edited proposed text"
            />
          ) : (
            <pre className="ws-approval-drawer__text ws-mono">{request.proposed}</pre>
          )}
        </section>

        <section className="ws-approval-drawer__section">
          <h3>Diff</h3>
          <pre className="ws-approval-drawer__diff ws-mono">
            {diffLines.map((line, i) => (
              <div key={i} className={`ws-approval-drawer__diff-line ws-approval-drawer__diff-line--${line.kind}`}>
                {line.text || " "}
              </div>
            ))}
          </pre>
        </section>

        {error ? (
          <p className="ws-approval-drawer__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="ws-approval-drawer__actions">
          <button
            type="button"
            className="ws-approval-drawer__btn ws-approval-drawer__btn--primary"
            data-testid="approve-btn"
            disabled={busy !== null || isResolved}
            onClick={() => void handleDecision(editing ? "edit" : "approve", editing ? editedText : undefined)}
          >
            Approve
          </button>
          <button
            type="button"
            className="ws-approval-drawer__btn"
            disabled={busy !== null || isResolved}
            onClick={() => setEditing((v) => !v)}
          >
            Edit text
          </button>
          <button
            type="button"
            className="ws-approval-drawer__btn ws-approval-drawer__btn--danger"
            data-testid="reject-btn"
            disabled={busy !== null || isResolved}
            onClick={() => void handleDecision("reject")}
          >
            Reject
          </button>
          <button
            type="button"
            className="ws-approval-drawer__btn"
            disabled={busy !== null || isResolved}
            onClick={() => void handleDecision("ignore")}
          >
            Ignore finding
          </button>
        </div>
      </div>
    </div>
  );
}
