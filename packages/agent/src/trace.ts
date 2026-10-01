// Trace event emission with hash chaining — Spec Section 15.4. Thin wrapper
// over @pramaan/core's appendEvent/GENESIS_HASH that tracks the running
// chain tail and accumulates events in memory for evidence.generate /
// writeReportBundle, while also forwarding every event to the caller's
// `RunAuditIO.emit` hook (CLI/server persist + stream it from there).

import { appendEvent, GENESIS_HASH, type TraceEvent, type TraceType } from "@pramaan/core";

export interface EmitInput {
  type: TraceType;
  actor: TraceEvent["actor"];
  payload: Record<string, unknown>;
}

export class TraceEmitter {
  private tail: string;
  private seq: number;
  readonly events: TraceEvent[] = [];

  constructor(
    private readonly onEmit?: (event: TraceEvent) => void,
    startTail: string = GENESIS_HASH,
    startSeq = 0,
  ) {
    this.tail = startTail;
    this.seq = startSeq;
  }

  get traceHead(): string {
    return this.tail;
  }

  emit(partial: EmitInput): TraceEvent {
    this.seq += 1;
    const event = appendEvent(this.tail, {
      seq: this.seq,
      ts: new Date().toISOString(),
      type: partial.type,
      actor: partial.actor,
      payload: partial.payload,
    });
    this.tail = event.hash;
    this.events.push(event);
    this.onEmit?.(event);
    return event;
  }
}
