// Maps PramaanError (and zod validation errors) to the Section 17.3 error
// shape and status codes.
import type { FastifyInstance, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { PramaanError, type ErrorCode } from "@pramaan/core";

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  E_BAD_INPUT: 400,
  E_NOT_FOUND: 404,
  E_STATE_CONFLICT: 409,
  E_LLM_UNAVAILABLE: 503,
  E_INTERNAL: 500,
};

export function sendError(
  reply: FastifyReply,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): void {
  const status = STATUS_BY_CODE[code] ?? 500;
  reply.status(status).send({ error: { code, message, details: details ?? {} } });
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof PramaanError) {
      sendError(reply, error.code, error.message, error.details);
      return;
    }
    if (error instanceof ZodError) {
      sendError(reply, "E_BAD_INPUT", "Request validation failed", {
        issues: error.issues,
      });
      return;
    }
    const withCode = error as { code?: unknown };
    if (typeof withCode.code === "string" && withCode.code.startsWith("E_")) {
      sendError(reply, withCode.code as ErrorCode, error.message);
      return;
    }
    app.log.error(error);
    sendError(reply, "E_INTERNAL", error.message ?? "Internal error");
  });

  app.setNotFoundHandler((_request, reply) => {
    sendError(reply, "E_NOT_FOUND", "Route not found");
  });
}
