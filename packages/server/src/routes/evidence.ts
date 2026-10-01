import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { verifyEvidencePack, type EvidencePack, type TraceEvent } from "@pramaan/core";
import { sendError } from "../errorHandler.js";

const bodySchema = z.object({
  pack: z.custom<EvidencePack>((v) => typeof v === "object" && v !== null),
  trace: z.string().optional(),
});

export function registerEvidenceVerifyRoute(app: FastifyInstance): void {
  app.post("/api/evidence/verify", async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(reply, "E_BAD_INPUT", "Invalid evidence verify request", { issues: parsed.error.issues });
      return;
    }

    let traceEvents: TraceEvent[] | undefined;
    if (parsed.data.trace) {
      try {
        traceEvents = parsed.data.trace
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line) => JSON.parse(line) as TraceEvent);
      } catch {
        sendError(reply, "E_BAD_INPUT", "trace must be newline-delimited JSON (trace.jsonl content)");
        return;
      }
    }

    const result = await verifyEvidencePack(parsed.data.pack, { traceEvents });
    return {
      valid: result.valid,
      checks: result.checks.map((c) => ({ name: c.name, pass: c.passed, detail: c.details })),
    };
  });
}
