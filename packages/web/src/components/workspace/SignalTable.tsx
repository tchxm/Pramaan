// SignalTable — spec Section 18.4. Renders the deterministic Signal[]
// computed by the engine for a finding. `fired` is shown as an icon plus
// text (never color alone, spec 18.8).
import type { Signal } from "../../types/core";
import "../../styles/workspace.css";

export interface SignalTableProps {
  signals: Signal[];
}

function formatObservedValue(value: string | number | boolean | null): string {
  if (value === null) return "null";
  return String(value);
}

export function SignalTable({ signals }: SignalTableProps): JSX.Element {
  if (signals.length === 0) {
    return <div className="ws-signal-table__empty">No signals recorded.</div>;
  }

  return (
    <table className="ws-signal-table" data-testid="signal-table">
      <thead>
        <tr>
          <th>Signal</th>
          <th>Fired</th>
          <th>Weight</th>
          <th>Observed</th>
        </tr>
      </thead>
      <tbody>
        {signals.map((signal) => (
          <tr key={signal.id}>
            <td className="ws-mono">{signal.id}</td>
            <td>
              <span
                className={
                  signal.fired
                    ? "ws-signal-table__fired ws-signal-table__fired--yes"
                    : "ws-signal-table__fired ws-signal-table__fired--no"
                }
              >
                <span className="ws-signal-table__fired-icon" aria-hidden="true">
                  {signal.fired ? "✓" : "✕"}
                </span>
                {signal.fired ? "Fired" : "Not fired"}
              </span>
            </td>
            <td className="ws-mono">{signal.weight.toFixed(2)}</td>
            <td className="ws-mono ws-signal-table__observed">
              {Object.entries(signal.observed)
                .map(([key, value]) => `${key}: ${formatObservedValue(value)}`)
                .join(", ") || "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
