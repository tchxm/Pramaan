// CascadeTable — spec Section 18.4. Renders the CSS cascade contenders
// the engine resolved for a CSS_CASCADE finding (Section 9.4), with the
// winning declaration visually marked (left accent bar + "winner" badge),
// never by color alone.
import type { CascadeEntry } from "@pramaan/core";
import "../../styles/workspace.css";

export interface CascadeTableProps {
  entries: CascadeEntry[];
}

function formatSpecificity(specificity: [number, number, number]): string {
  return specificity.join(",");
}

export function CascadeTable({ entries }: CascadeTableProps): JSX.Element {
  if (entries.length === 0) {
    return <div className="ws-cascade-table__empty">No cascade contenders recorded.</div>;
  }

  return (
    <table className="ws-cascade-table" data-testid="cascade-table">
      <thead>
        <tr>
          <th>Property</th>
          <th>Value</th>
          <th>Important</th>
          <th>File</th>
          <th>Selector</th>
          <th>Line</th>
          <th>Specificity</th>
          <th>Origin</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, index) => (
          <tr
            key={`${entry.file}-${entry.selector}-${entry.line}-${index}`}
            className={entry.winner ? "ws-cascade-table__row ws-cascade-table__row--winner" : "ws-cascade-table__row"}
          >
            <td className="ws-mono">{entry.property}</td>
            <td className="ws-mono">{entry.value}</td>
            <td>{entry.important ? "Yes" : "No"}</td>
            <td className="ws-mono">{entry.file}</td>
            <td className="ws-mono">{entry.selector}</td>
            <td className="ws-mono">{entry.line}</td>
            <td className="ws-mono">{formatSpecificity(entry.specificity)}</td>
            <td>{entry.origin}</td>
            <td>
              {entry.winner && <span className="ws-cascade-table__badge">Winner</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
