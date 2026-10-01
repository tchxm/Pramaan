import type { TraceEvent } from "../../types/core";
import { ProvenanceChip, type ProvenanceActor } from "./ProvenanceChip.js";
import "../../styles/workspace.css";

export interface TraceDetailProps {
  event: TraceEvent;
}

/**
 * Expanded single-event view, used when a TraceStrip row is selected.
 * SECURITY (I-07): payload content may be derived from scanned source text
 * and is untrusted. It is rendered with plain JSX text interpolation (via
 * JSON.stringify, printed as a text node) — never dangerouslySetInnerHTML —
 * so React's escaping applies no matter what the payload contains.
 */
export function TraceDetail({ event }: TraceDetailProps): JSX.Element {
  return (
    <div className="ws-trace-detail">
      <div className="ws-trace-detail__header">
        <span className="ws-mono">#{event.seq}</span>
        <ProvenanceChip actor={event.actor as ProvenanceActor} />
        <span className="ws-mono">{event.type}</span>
        <time className="ws-trace-detail__ts ws-mono" dateTime={event.ts}>
          {event.ts}
        </time>
      </div>
      <dl className="ws-trace-detail__hashes">
        <div>
          <dt>prevHash</dt>
          <dd className="ws-mono" title={event.prevHash}>
            {truncateHash(event.prevHash)}
          </dd>
        </div>
        <div>
          <dt>hash</dt>
          <dd className="ws-mono" title={event.hash}>
            {truncateHash(event.hash)}
          </dd>
        </div>
      </dl>
      <pre className="ws-trace-detail__payload ws-mono">{JSON.stringify(event.payload, null, 2)}</pre>
    </div>
  );
}

function truncateHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
}
