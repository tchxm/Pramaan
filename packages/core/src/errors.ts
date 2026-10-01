import type { ZodError } from "zod";
import type { ErrorCode } from "./types.js";

/**
 * Strips non-JSON-safe values (functions, symbols, bigint) from an
 * arbitrary value, recursively. Needed because zod's `invalid_union`
 * issues embed full `ZodError` instances — with bound methods like
 * `addIssue`/`addIssues` as *own enumerable* properties — inside
 * `unionErrors`. Passing those straight through into a `Result`/trace
 * payload crashes `canonicalJson` (used for the evidence hash chain) the
 * moment any tool call fails a union-typed field — which a real LLM will
 * eventually do, not just a hand-crafted test. `canonicalJson` itself
 * stays strict (it's the thing with the integrity guarantee to protect);
 * this sanitizes at the point error details are captured, before they
 * ever reach it.
 */
function sanitizeForJson(value: unknown, depth = 0): unknown {
  if (depth > 10) return undefined; // guard against pathological nesting
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return value;
  if (t === "function" || t === "symbol" || t === "bigint") return undefined;
  if (Array.isArray(value)) return value.map((v) => sanitizeForJson(v, depth + 1));
  if (t === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const sanitized = sanitizeForJson((value as Record<string, unknown>)[key], depth + 1);
      if (sanitized !== undefined) out[key] = sanitized;
    }
    return out;
  }
  return undefined;
}

/**
 * Drop-in, JSON-safe replacement for `zodError.issues` — use this instead
 * of reading `.issues` directly whenever a zod validation failure's
 * details get embedded in a `fail()`/`sendError()` call (which is every
 * tool-input and API-body validation in this codebase; see errors.ts
 * callers).
 */
export function zodIssues(error: ZodError): unknown[] {
  return sanitizeForJson(error.issues) as unknown[];
}

export class PramaanError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "PramaanError";
    this.code = code;
    this.details = details;
  }

  toJSON(): { code: ErrorCode; message: string; details?: Record<string, unknown> } {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export function err(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): PramaanError {
  return new PramaanError(code, message, details);
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; details?: Record<string, unknown> } };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail<T = never>(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): Result<T> {
  return { ok: false, error: { code, message, details } };
}
