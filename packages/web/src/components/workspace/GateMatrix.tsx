import type { Finding, GateId, VerifyResult } from "../../types/core";
import "../../styles/workspace.css";

export interface GateMatrixProps {
  findings: Finding[];
  verifyByFinding: Record<string, VerifyResult | undefined>;
}

const GATES: GateId[] = ["G1_DETECTOR_CLEAR", "G2_PRESERVATION", "G3_BUILD", "G4_RUNTIME", "G5_NO_REGRESSION"];
const GATE_LABEL: Record<GateId, string> = {
  G1_DETECTOR_CLEAR: "G1",
  G2_PRESERVATION: "G2",
  G3_BUILD: "G3",
  G4_RUNTIME: "G4",
  G5_NO_REGRESSION: "G5",
};

type CellState = "pass" | "fail" | "not_run" | "pending";

function cellIcon(state: CellState): JSX.Element {
  const common = { width: 12, height: 12, viewBox: "0 0 12 12", "aria-hidden": true } as const;
  if (state === "pass") {
    return (
      <svg {...common}>
        <path d="M2.4 6.2 4.8 8.6 9.6 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (state === "fail") {
    return (
      <svg {...common}>
        <line x1="3" y1="3" x2="9" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="9" y1="3" x2="3" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  // not_run and pending share a neutral dash glyph — text differs below.
  return (
    <svg {...common}>
      <line x1="3" y1="6" x2="9" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const CELL_TEXT: Record<CellState, string> = {
  pass: "Pass",
  fail: "Fail",
  not_run: "Not run",
  pending: "Not yet verified",
};

/**
 * S4 gate matrix. CRITICAL (spec 18.3): every tick corresponds to an actual
 * deterministic gate result from a `verify.result` event — never pre-filled
 * green, never animated to a fabricated outcome. A cell is "pending" (not
 * "pass") until `verifyByFinding[findingId]` actually exists; the only
 * transition is a plain CSS color/background fade driven by the real prop
 * change, which `prefers-reduced-motion` disables (see workspace.css).
 */
export function GateMatrix({ findings, verifyByFinding }: GateMatrixProps): JSX.Element {
  return (
    <div className="ws-gate-matrix">
      <p className="ws-gate-matrix__banner">Verdicts come from the deterministic engine, not the model.</p>
      <table className="ws-gate-matrix__table">
        <thead>
          <tr>
            <th scope="col">Finding</th>
            {GATES.map((g) => (
              <th scope="col" key={g}>
                {GATE_LABEL[g]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {findings.map((finding) => {
            const verify = verifyByFinding[finding.findingId];
            return (
              <tr key={finding.findingId} data-testid={`finding-row-${finding.findingId}`}>
                <th scope="row" className="ws-gate-matrix__finding">
                  <span className="ws-mono">{finding.findingId}</span>
                </th>
                {GATES.map((gateId) => {
                  const gateResult = verify?.gates.find((g) => g.gate === gateId);
                  const state: CellState = gateResult ? (gateResult.status as CellState) : "pending";
                  return (
                    <td
                      key={gateId}
                      data-testid={`gate-${gateId}`}
                      className={`ws-gate-matrix__cell ws-gate-matrix__cell--${state}`}
                    >
                      <span className="ws-gate-matrix__cell-icon">{cellIcon(state)}</span>
                      <span className="ws-gate-matrix__cell-text">{CELL_TEXT[state]}</span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
