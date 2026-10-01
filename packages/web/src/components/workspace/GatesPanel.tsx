// GatesPanel — spec Section 18.4 / 18.6. Renders the five deterministic
// gates (G1..G5) for a finding's latest VerifyResult. The banner copy is
// fixed verbatim per 18.6. This component does not import ProvenanceChip
// (another engineer's in-progress file) — it reuses the shared
// `.ws-provenance-chip--engine` class already defined in workspace.css to
// get the same ink-filled "Engine" chip look without a cross-file import.
// When `pending` is true (verification not yet run/finished) every gate
// renders as an explicit pending state — never a fabricated pass or fail.
import type { GateId, VerifyResult } from "@pramaan/core";
import "../../styles/workspace.css";

export interface GatesPanelProps {
  verify?: VerifyResult;
  pending?: boolean;
}

const GATE_ORDER: { id: GateId; label: string }[] = [
  { id: "G1_DETECTOR_CLEAR", label: "G1 · Detector clear" },
  { id: "G2_PRESERVATION", label: "G2 · Preservation" },
  { id: "G3_BUILD", label: "G3 · Build" },
  { id: "G4_RUNTIME", label: "G4 · Runtime" },
  { id: "G5_NO_REGRESSION", label: "G5 · No regression" },
];

type DisplayStatus = "pending" | "pass" | "fail" | "not_run";

function statusIcon(status: DisplayStatus): string {
  switch (status) {
    case "pass":
      return "✓";
    case "fail":
      return "✕";
    case "not_run":
      return "–";
    case "pending":
    default:
      return "⋯";
  }
}

function statusLabel(status: DisplayStatus): string {
  switch (status) {
    case "pass":
      return "Pass";
    case "fail":
      return "Fail";
    case "not_run":
      return "Not run";
    case "pending":
    default:
      return "Pending";
  }
}

export function GatesPanel({ verify, pending }: GatesPanelProps): JSX.Element {
  return (
    <div className="ws-gates-panel" data-testid="gates-panel">
      <div className="ws-gates-panel__banner">
        <span className="ws-provenance-chip ws-provenance-chip--engine">Engine</span>
        <span className="ws-gates-panel__banner-text">
          Verdicts come from the deterministic engine, not the model.
        </span>
      </div>
      <ul className="ws-gates-panel__list">
        {GATE_ORDER.map(({ id, label }) => {
          const result = verify?.gates.find((g) => g.gate === id);
          const status: DisplayStatus = pending || !verify ? "pending" : (result?.status ?? "not_run");
          return (
            <li
              key={id}
              className={`ws-gates-panel__gate ws-gates-panel__gate--${status}`}
              data-testid={`gate-${id.split("_")[0]}`}
            >
              <span className="ws-gates-panel__gate-icon" aria-hidden="true">
                {statusIcon(status)}
              </span>
              <span className="ws-gates-panel__gate-label">{label}</span>
              <span className="ws-gates-panel__gate-status">{statusLabel(status)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
