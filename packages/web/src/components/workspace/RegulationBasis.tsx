// RegulationBasis — spec Section 18.4 / 18.6. Shows the plain-language
// basis for a finding's regulatory relevance. Raw statute text is never
// shown unless `verifiedAgainstGazette` is true; otherwise the exact copy
// from spec 18.6 is shown so nobody mistakes an unverified paraphrase for
// a checked legal citation.
import type { RegulationRef } from "../../types/core";
import "../../styles/workspace.css";

export interface RegulationBasisProps {
  refs: RegulationRef[];
}

const UNVERIFIED_NOTE = "Reference not yet checked against the gazette";

export function RegulationBasis({ refs }: RegulationBasisProps): JSX.Element {
  if (refs.length === 0) {
    return <div className="ws-regulation-basis__empty">No regulatory basis recorded.</div>;
  }

  return (
    <ul className="ws-regulation-basis" data-testid="regulation-basis">
      {refs.map((ref, index) => (
        <li className="ws-regulation-basis__item" key={`${ref.framework}-${index}`}>
          <div className="ws-regulation-basis__framework">{ref.framework}</div>
          <div className="ws-regulation-basis__pattern">{ref.patternName}</div>
          <p className="ws-regulation-basis__basis">{ref.plainBasis}</p>
          {ref.verifiedAgainstGazette ? (
            <p className="ws-regulation-basis__duty ws-mono">{ref.auditDuty}</p>
          ) : (
            <p className="ws-regulation-basis__unverified">{UNVERIFIED_NOTE}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
