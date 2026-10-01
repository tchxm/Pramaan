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

  const record = store.get(auditId);
  const maxSeq = record ? record.trace.at(-1)?.seq ?? 0 : 0;

  // Replay every trace event the client hasn't seen yet — on a fresh
  // connect (no Last-Event-ID) that means the FULL history from seq 0, not
  // just events from here on. Without this, opening or refreshing the
  // workspace for an audit that's already progressed (which, for a fast
  // audit, is the common case, not the edge case) shows an empty trace
  // strip despite the full provenance record existing on the server —
  // undermining the actual "evidence" product claim. Sent in chronological
  // order BEFORE the snapshot, so the client's last-seen id ends up at
  // `maxSeq` (from the snapshot) rather than regressing backwards.
  const afterSeq = lastEventId ? Number.parseInt(lastEventId, 10) : 0;
  if (Number.isFinite(afterSeq)) {
    for (const event of store.eventsAfter(auditId, afterSeq)) {
      writeEvent(reply, event);
    }
  }

  // audit.snapshot is sent last, so it reflects current state once the
  // client has replayed everything that led up to it.
  const snapshot = store.snapshot(auditId);
  if (snapshot) {
    writeSnapshot(reply, maxSeq, snapshot);
  }

  const unsubscribe = store.subscribe(auditId, (event) => {
    writeEvent(reply, event);
  });

  const heartbeat = setInterval(() => {
    reply.raw.write(`: ping\n\n`);
  }, HEARTBEAT_MS);

  reply.raw.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
