// SSE client — Spec Section 17.2 / 18.5.
// Native EventSource does not let us set a custom `Last-Event-ID` header on
// the INITIAL connection (only automatically resends its own last-seen id on
// browser-driven reconnects), and it does not expose per-named-event access
// generically, so we hand-roll a small fetch+ReadableStream-based client that
// gives us full control over reconnect backoff and event framing while
// keeping the same on-the-wire SSE protocol the server speaks.
import type { TraceEvent } from "@pramaan/core";

export interface AuditSnapshotPayload {
  audit: unknown;
  findings: unknown[];
  pendingApprovals: unknown[];
}

export type SseHandlers = {
  onSnapshot: (payload: AuditSnapshotPayload) => void;
  onTraceEvent: (event: TraceEvent) => void;
  onConnectionChange: (state: "connecting" | "live" | "reconnecting" | "closed") => void;
};

const RECONNECT_DELAY_MS = 2000;

export function subscribeToAuditEvents(url: string, handlers: SseHandlers): () => void {
  let lastEventId: string | undefined;
  let closed = false;
  let abortController: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async function connect(): Promise<void> {
    if (closed) return;
    handlers.onConnectionChange(lastEventId ? "reconnecting" : "connecting");
    abortController = new AbortController();

    try {
      const headers: Record<string, string> = {};
      if (lastEventId) headers["Last-Event-ID"] = lastEventId;

      const res = await fetch(url, { headers, signal: abortController.signal });
      if (!res.ok || !res.body) {
        throw new Error(`SSE connection failed with status ${res.status}`);
      }
      handlers.onConnectionChange("live");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line.
        let sepIndex: number;
        while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);
          handleFrame(frame);
        }
      }
    } catch (cause) {
      if (closed) return;
      void cause; // network error or abort; fall through to reconnect
    }

    if (!closed) {
      handlers.onConnectionChange("reconnecting");
      reconnectTimer = setTimeout(() => void connect(), RECONNECT_DELAY_MS);
    }
  }

  function handleFrame(frame: string): void {
    let id: string | undefined;
    let eventType = "message";
    const dataLines: string[] = [];

    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) continue; // heartbeat comment
      if (line.startsWith("id:")) id = line.slice(3).trim();
      else if (line.startsWith("event:")) eventType = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }

    if (id) lastEventId = id;
    if (dataLines.length === 0) return;

    let payload: unknown;
    try {
      payload = JSON.parse(dataLines.join("\n"));
    } catch {
      return; // malformed frame; skip rather than crash the stream
    }

    if (eventType === "audit.snapshot") {
      handlers.onSnapshot(payload as AuditSnapshotPayload);
    } else {
      // Full TraceEvent (see server sse.ts fix — payload now carries the
      // whole event, not just its `.payload` field).
      handlers.onTraceEvent(payload as TraceEvent);
    }
  }

  void connect();

  return function unsubscribe(): void {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    abortController?.abort();
    handlers.onConnectionChange("closed");
  };
}
