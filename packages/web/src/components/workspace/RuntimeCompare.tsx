// RuntimeCompare — spec Section 18.4. Shows the before/after runtime
// screenshots (G4 evidence) side by side, plus the observed runtime values
// the engine recorded. Screenshot URLs may be undefined (runtime checks
// off, or not yet captured) — this never renders a broken <img>, only the
// documented fallback text.
import "../../styles/workspace.css";

export interface RuntimeCompareProps {
  beforeSrc?: string;
  afterSrc?: string;
  observed: Record<string, unknown>;
}

function formatObservedValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function RuntimeCompare({ beforeSrc, afterSrc, observed }: RuntimeCompareProps): JSX.Element {
  const observedEntries = Object.entries(observed);

  return (
    <div className="ws-runtime-compare" data-testid="runtime-compare">
      <div className="ws-runtime-compare__shots">
        <div className="ws-runtime-compare__shot">
          <div className="ws-runtime-compare__shot-label">Before</div>
          {beforeSrc ? (
            <img className="ws-runtime-compare__img" src={beforeSrc} alt="Runtime screenshot before the fix" />
          ) : (
            <div className="ws-runtime-compare__shot-empty">No runtime screenshot available yet</div>
          )}
        </div>
        <div className="ws-runtime-compare__shot">
          <div className="ws-runtime-compare__shot-label">After</div>
          {afterSrc ? (
            <img className="ws-runtime-compare__img" src={afterSrc} alt="Runtime screenshot after the fix" />
          ) : (
            <div className="ws-runtime-compare__shot-empty">No runtime screenshot available yet</div>
          )}
        </div>
      </div>
      {observedEntries.length > 0 && (
        <table className="ws-runtime-compare__table">
          <thead>
            <tr>
              <th>Observed</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {observedEntries.map(([key, value]) => (
              <tr key={key}>
                <td className="ws-mono">{key}</td>
                <td className="ws-mono">{formatObservedValue(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
