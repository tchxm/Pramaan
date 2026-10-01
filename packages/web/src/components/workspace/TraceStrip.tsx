import type { TraceEvent } from "@pramaan/core";
import { ProvenanceChip, type ProvenanceActor } from "./ProvenanceChip.js";
import "../../styles/workspace.css";

export interface TraceStripProps {
  events: TraceEvent[];
  onSelect(seq: number): void;
}

/**
 * Summarize a trace event's payload into a short, meaningful line instead of
 * dumping raw JSON (spec 18.4). Falls back to the event type itself when the
 * payload doesn't carry a field we recognize.
 */
function summarize(event: TraceEvent): string {
  const p = event.payload as Record<string, unknown>;
  switch (event.type) {
    case "audit.started":
      return typeof p.projectName === "string" ? `started audit of ${p.projectName}` : "audit started";
    case "scan.completed":
      return typeof p.findingCount === "number" ? `scan found ${p.findingCount} finding(s)` : "scan completed";
    case "agent.plan":
      return typeof p.strategy === "string" ? `proposed strategy ${p.strategy}` : "proposed a plan";
    case "agent.tool_call":
      return typeof p.tool === "string" ? `called ${p.tool}` : "called a tool";
    case "tool.result":
      return typeof p.tool === "string" ? `result from ${p.tool}` : "tool result";
    case "agent.reason": {
      const text = typeof p.text === "string" ? p.text : typeof p.reason === "string" ? p.reason : "";
      return text ? truncate(text, 80) : "agent reasoning";
    }
    case "policy.reject":
      return typeof p.code === "string" ? `rejected: ${p.code}` : "policy rejected an operation";
    case "approval.requested":
      return "requested your approval";
    case "approval.resolved":
      return typeof p.decision === "string" ? `you decided: ${p.decision}` : "approval resolved";
    case "patch.applied":
      return typeof p.findingId === "string" ? `applied patch for ${p.findingId}` : "applied patch";
    case "verify.result":
      return typeof p.verdict === "string" ? `verdict: ${p.verdict}` : "verify result";
    case "evidence.generated":
      return "evidence pack generated";
    case "audit.completed":
      return "audit completed";
    case "error":
      return typeof p.message === "string" ? truncate(p.message, 80) : "error";
    default:
      return event.type;
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * NOTE on scope: spec 18.3 marks the trace strip as resizable (nice-to-have,
 * not required for correctness). This implementation is a fixed-height
 * (168px, matching the S2 layout spec) scrollable log instead, which is the
 * explicitly-sanctioned fallback for time-constrained builds. Resizing can
 * be layered on later without changing this component's props.
 */
export function TraceStrip({ events, onSelect }: TraceStripProps): JSX.Element {
  return (
    <div className="ws-trace-strip" role="log" aria-live="off" aria-label="Agent trace">
      {events.length === 0 ? (
        <div className="ws-trace-strip__empty">Scanning files</div>
      ) : (
        <ul className="ws-trace-strip__list">
          {events.map((event) => (
            <li key={event.seq}>
              <button
                type="button"
                className="ws-trace-strip__row"
                data-testid={`trace-event-${event.seq}`}
                onClick={() => onSelect(event.seq)}
              >
                <span className="ws-trace-strip__seq ws-mono">{event.seq}</span>
                <ProvenanceChip actor={event.actor as ProvenanceActor} />
                <span className="ws-trace-strip__type ws-mono">{event.type}</span>
                <span className="ws-trace-strip__summary">{summarize(event)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
