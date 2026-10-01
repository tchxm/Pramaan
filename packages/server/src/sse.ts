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
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const record = store.get(auditId);
  const maxSeq = record ? record.trace.at(-1)?.seq ?? 0 : 0;

  // audit.snapshot is sent immediately on connect, regardless of reconnect.
  const snapshot = store.snapshot(auditId);
  if (snapshot) {
    writeSnapshot(reply, maxSeq, snapshot);
  }

  const afterSeq = lastEventId ? Number.parseInt(lastEventId, 10) : 0;
  if (Number.isFinite(afterSeq) && afterSeq > 0) {
    for (const event of store.eventsAfter(auditId, afterSeq)) {
      writeEvent(reply, event);
    }
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
