// SSE stream helper. Spec Section 17.2.
import type { FastifyReply } from "fastify";
import type { TraceEvent } from "@pramaan/core";
import type { AuditStore } from "./store.js";

const HEARTBEAT_MS = 15_000;

function writeEvent(reply: FastifyReply, event: TraceEvent): void {
  // Send the FULL TraceEvent as data, not just payload — the frontend needs
  // `actor` (engine/agent/human provenance, spec 18.6's core truthfulness
  // claim) and `seq`/`ts`/hash fields for its trace strip and reconnect
  // dedup logic. `id`/`event` are still set per SSE protocol for
  // EventSource's native id tracking and addEventListener(type, ...).
  reply.raw.write(`id: ${event.seq}\n`);
  reply.raw.write(`event: ${event.type}\n`);
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

function writeSnapshot(reply: FastifyReply, seq: number, payload: unknown): void {
  reply.raw.write(`id: ${seq}\n`);
  reply.raw.write(`event: audit.snapshot\n`);
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function streamAuditEvents(
  store: AuditStore,
  auditId: string,
  reply: FastifyReply,
  lastEventId: string | undefined,
): void {
  // reply.raw.writeHead() writes the HTTP response head directly, bypassing
  // Fastify's own reply pipeline entirely — any header @fastify/cors queued
  // via reply.header() in its onRequest hook is silently dropped unless we
  // pull it back out and pass it through here explicitly. Without this, the
  // browser's EventSource/fetch-stream request is blocked by CORS even
  // though every other route on this same server sets the header correctly.
  const corsHeaders: Record<string, string> = {};
  for (const name of ["access-control-allow-origin", "access-control-allow-credentials", "vary"]) {
    const value = reply.getHeader(name);
    if (typeof value === "string") corsHeaders[name] = value;
  }

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...corsHeaders,
  });

  // Replay every trace event the client hasn't seen yet — on a fresh
  // connect (no Last-Event-ID) that means the FULL history from seq 0, not
  // just events from here on. Without this, opening or refreshing the
  // workspace for an audit that's already progressed (which, for a fast
  // audit, is the common case, not the edge case) shows an empty trace
  // strip despite the full provenance record existing on the server —
  // undermining the actual "evidence" product claim. Sent in chronological
  // order BEFORE the snapshot, so the client's last-seen id ends up at
  // the snapshot's seq rather than regressing backwards.
  const afterSeq = lastEventId ? Number.parseInt(lastEventId, 10) : 0;
  if (Number.isFinite(afterSeq)) {
    for (const event of store.eventsAfter(auditId, afterSeq)) {
      writeEvent(reply, event);
    }
  }

  // Events whose arrival means `record.audit` just changed in a way the
  // client's snapshot-derived state (findingsById, audit.findings, etc.)
  // can't reconstruct from the event payload alone — scan.completed's
  // payload is just a count, not the findings array itself.
  const SNAPSHOT_REFRESH_EVENTS = new Set([
    "scan.completed",
    "patch.applied",
    "verify.result",
    "evidence.generated",
    "audit.completed",
  ]);

  // `record.audit` is reassigned to the final Audit object by runAudit()'s
  // CALLER, strictly after that promise resolves — which is strictly after
  // the LAST trace event (e.g. audit.completed) was emitted from inside
  // runAudit() itself. A client connecting in that narrow window (very
  // reachable for a fast, no-LLM audit: POST /api/audits returns 202
  // immediately while runAudit() runs fire-and-forget, so a client can
  // easily connect before OR in the gap right after it finishes) would see
  // the full historical trace already replayed above, yet still get an
  // empty-findings snapshot — and since the audit already finished, no
  // FUTURE event will ever arrive to let it self-correct. setImmediate
  // defers past the current microtask queue, by which point any in-flight
  // assignment has landed, so this always sends a truthful snapshot.
  function sendFreshSnapshot(seq: number): void {
    setImmediate(() => {
      const fresh = store.snapshot(auditId);
      if (fresh) writeSnapshot(reply, seq, fresh);
    });
  }

  const unsubscribe = store.subscribe(auditId, (event) => {
    writeEvent(reply, event);
    if (SNAPSHOT_REFRESH_EVENTS.has(event.type)) sendFreshSnapshot(event.seq);
  });

  const initialMaxSeq = store.get(auditId)?.trace.at(-1)?.seq ?? 0;
  sendFreshSnapshot(initialMaxSeq);

  const heartbeat = setInterval(() => {
    reply.raw.write(`: ping\n\n`);
  }, HEARTBEAT_MS);

  reply.raw.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
