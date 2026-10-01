import "../../styles/workspace.css";

export interface EvidenceTagProps {
  index: number;
}

/**
 * Amber numbered marker for a finding — findings are an ordered list of
 * evidence, and the tag is the structural device that says so (spec 18.2).
 */
export function EvidenceTag({ index }: EvidenceTagProps): JSX.Element {
  return (
    <span className="ws-evidence-tag" aria-label={`Evidence ${index}`}>
      {index}
    </span>
  );
}
