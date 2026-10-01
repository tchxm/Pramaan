// EvidencePanel — spec Section 18.4.
//
// DESIGN DECISION (for the screens engineer): spec 18.4 lists SignalTable,
// CascadeTable and RegulationBasis as separate components from
// EvidencePanel, each with its own distinct props (`signals: Signal[]`,
// `entries: CascadeEntry[]`, `refs: RegulationRef[]`) rather than a single
// `finding: Finding` prop. So EvidencePanel does NOT compose them
// internally. It owns only the parts of `Finding.evidence` that aren't
// already covered by one of those three: the source location, the
// line-numbered source snippet, the observed key/value table, and the
// warnings list. Render EvidencePanel ALONGSIDE separate SignalTable,
// CascadeTable and RegulationBasis instances, fed from
// `finding.signals`, `finding.evidence.cascade ?? []` and
// `finding.regulation` respectively:
//
//   <EvidencePanel finding={finding} />
//   <SignalTable signals={finding.signals} />
//   {finding.evidence.cascade && <CascadeTable entries={finding.evidence.cascade} />}
//   <RegulationBasis refs={finding.regulation} />
//
// `finding.evidence.sourceSnippet` is scanned source text — untrusted per
// invariant I-07. It is rendered only through JSX text interpolation
// (which escapes it), never via dangerouslySetInnerHTML.
import { useMemo } from "react";
import type { Finding } from "@pramaan/core";
import "../../styles/workspace.css";

export interface EvidencePanelProps {
  finding: Finding;
}

function formatObservedValue(value: string | number | boolean | null): string {
  if (value === null) return "null";
  return String(value);
}

export function EvidencePanel({ finding }: EvidencePanelProps): JSX.Element {
  const { evidence, location } = finding;
  const snippetLines = useMemo(() => evidence.sourceSnippet.split("\n"), [evidence.sourceSnippet]);
  const observedEntries = Object.entries(evidence.observed);
  const gutterWidth = String(location.endLine).length;

  return (
    <div className="ws-evidence-panel" data-testid="evidence-panel">
      <div className="ws-evidence-panel__location ws-mono">
        {location.file}:{location.startLine}
        {location.endLine !== location.startLine ? `-${location.endLine}` : ""}
      </div>

      <pre className="ws-evidence-panel__snippet">
        <code>
          {snippetLines.map((line, i) => {
            const lineNumber = location.startLine + i;
            return (
              <div key={lineNumber} className="ws-evidence-panel__snippet-line">
                <span className="ws-evidence-panel__gutter ws-mono" style={{ minWidth: `${gutterWidth}ch` }}>
                  {lineNumber}
                </span>
                <span className="ws-evidence-panel__snippet-text ws-mono">
                  {line.length === 0 ? " " : line}
                </span>
              </div>
            );
          })}
        </code>
      </pre>

      {observedEntries.length > 0 && (
        <table className="ws-evidence-panel__observed">
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

      {evidence.warnings.length > 0 && (
        <ul className="ws-evidence-panel__warnings">
          {evidence.warnings.map((warning) => (
            <li key={warning} className="ws-evidence-panel__warning ws-mono">
              {warning}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
