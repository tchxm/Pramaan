import type { Finding, Severity } from "@pramaan/core";
import { StatusPill } from "./StatusPill";
import "../../styles/workspace.css";

export interface FindingListProps {
  findings: Finding[];
  selectedId?: string;
  onSelect: (id: string) => void;
  progressLabels?: Record<string, string>;
}

// Severity reuses existing tokens rather than inventing new colors (spec
// 18.2 forbids new chrome): high -> --violation, medium -> --review,
// low -> --slate, via the ws-finding-row__severity--<severity> classes.
const SEVERITY_LABEL: Record<Severity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/**
 * Findings as table-style rows, not cards (spec rejects "a grid of
 * identical rounded cards"). Each row shows title, rule id, severity and
 * a StatusPill so the verdict is always visible alongside the claim.
 */
export function FindingList({ findings, selectedId, onSelect, progressLabels }: FindingListProps): JSX.Element {
  if (findings.length === 0) {
    return (
      <p className="ws-finding-list__empty">
        No deceptive patterns found in the scanned files.
      </p>
    );
  }

  return (
    <div className="ws-finding-list" role="list">
      {findings.map((f) => {
        const isSelected = f.findingId === selectedId;
        return (
          <button
            key={f.findingId}
            type="button"
            role="listitem"
            data-testid={`finding-row-${f.findingId}`}
            className={`ws-finding-row${isSelected ? " ws-finding-row--selected" : ""}`}
            aria-current={isSelected ? "true" : undefined}
            onClick={() => onSelect(f.findingId)}
          >
            <span className="ws-finding-row__title">{f.title}</span>
            <span className="ws-finding-row__meta">
              <span className="ws-finding-row__rule ws-mono">{f.ruleId}</span>
              <span className={`ws-finding-row__severity ws-finding-row__severity--${f.severity}`}>
                {SEVERITY_LABEL[f.severity]}
              </span>
              <StatusPill status={f.status} />
            </span>
            {progressLabels?.[f.findingId] && <span className="ws-finding-row__progress">{progressLabels[f.findingId]}</span>}
          </button>
        );
      })}
    </div>
  );
}
