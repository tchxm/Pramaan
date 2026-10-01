import "../../styles/workspace.css";

export type WorkspacePhase = "scan" | "investigate" | "fix" | "verify" | "evidence" | "done";

export interface PhaseBarProps {
  phase: WorkspacePhase;
  failed?: boolean;
}

const PHASES: { id: WorkspacePhase; label: string }[] = [
  { id: "scan", label: "Scan" },
  { id: "investigate", label: "Investigate" },
  { id: "fix", label: "Fix" },
  { id: "verify", label: "Verify" },
  { id: "evidence", label: "Evidence" },
];

/**
 * Ordered phase sequence for the workspace header. `aria-live="polite"` per
 * spec 18.8 so screen readers announce phase transitions as they happen.
 * When `failed` is true and the audit has reached its terminal state
 * ("done"), the done indicator renders in the violation color instead of
 * looking like an ordinary success — "done" is not the same as "succeeded".
 */
export function PhaseBar({ phase, failed = false }: PhaseBarProps): JSX.Element {
  const activeIndex = PHASES.findIndex((p) => p.id === phase);
  const isDone = phase === "done";

  return (
    <div className="ws-phase-bar" data-testid="phase-bar" role="status" aria-live="polite">
      {PHASES.map((p, i) => {
        const isActive = !isDone && p.id === phase;
        const isPast = isDone || i < activeIndex;
        const className = [
          "ws-phase-step",
          isActive ? "ws-phase-step--active" : "",
          isPast && !isActive ? "ws-phase-step--done" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <span key={p.id} style={{ display: "flex", alignItems: "center" }}>
            {i > 0 ? <span className="ws-phase-sep" aria-hidden="true">&middot;</span> : null}
            <span className={className}>
              <span className="ws-phase-step__dot" aria-hidden="true" />
              {p.label}
            </span>
          </span>
        );
      })}
      <span className="ws-phase-sep" aria-hidden="true">&middot;</span>
      <span className={`ws-phase-step${isDone ? (failed ? " ws-phase-step--failed" : " ws-phase-step--done") : ""}`}>
        <span className="ws-phase-step__dot" aria-hidden="true" />
        {isDone ? (failed ? "Done — human review needed" : "Done") : "Done"}
      </span>
    </div>
  );
}
