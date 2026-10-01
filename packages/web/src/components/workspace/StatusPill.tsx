import type { FindingStatus } from "../../types/core";
import "../../styles/workspace.css";

export interface StatusPillProps {
  status: FindingStatus;
  label?: string;
}

// Fixed copy — spec Section 18.6. "remediating" is not in the spec's table
// but is a real FindingStatus the engine emits mid-fix; "Remediating" is a
// reasonable interim label.
const STATUS_TEXT: Record<FindingStatus, string> = {
  open: "Open",
  remediating: "Remediating",
  awaiting_approval: "Waiting for your approval",
  verified: "Fixed and verified",
  static_verified: "Fixed, static checks only",
  failed: "Fix failed. Human review needed",
  ignored: "Ignored by you",
};

function Icon({ status }: { status: FindingStatus }): JSX.Element {
  const common = { width: 14, height: 14, viewBox: "0 0 14 14", "aria-hidden": true } as const;
  switch (status) {
    case "verified":
      return (
        <svg {...common}>
          <path d="M3 7.2 5.6 10 11 3.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "static_verified":
      return (
        <svg {...common}>
          <path d="M3 7.2 5.6 10 11 3.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2.2 2.2" />
        </svg>
      );
    case "failed":
      return (
        <svg {...common}>
          <path d="M7 1.6 12.6 11.6 1.4 11.6Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <line x1="7" y1="5.4" x2="7" y2="8.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <circle cx="7" cy="9.8" r="0.7" fill="currentColor" />
        </svg>
      );
    case "awaiting_approval":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M7 4.1V7l2.2 1.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "remediating":
      return (
        <svg {...common}>
          <path d="M11.3 7A4.3 4.3 0 1 1 9.9 3.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M11.3 2.6V5H8.9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "ignored":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <line x1="4.2" y1="4.2" x2="9.8" y2="9.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "open":
    default:
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.3" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
  }
}

/**
 * Status is never communicated by color alone (spec 18.8): every pill pairs
 * a hand-drawn icon with the fixed copy string for that status.
 */
// Note: spec 18.4's testid table lists a single `verdict-chip` id. Since
// StatusPill renders many times per screen (one per finding row), that id
// is NOT applied here — it would collide. The screens engineer should add
// `data-testid="verdict-chip"` at the one call site that needs it (e.g. a
// single-finding detail view), by wrapping or spreading props onto the
// rendered <span>.
export function StatusPill({ status, label }: StatusPillProps): JSX.Element {
  return (
    <span className={`ws-status-pill ws-status-pill--${label && status === "failed" ? "awaiting_approval" : status}`}>
      <span className="ws-status-pill__icon">
        <Icon status={status} />
      </span>
      {label ?? STATUS_TEXT[status]}
    </span>
  );
}
