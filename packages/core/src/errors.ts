import type { ErrorCode } from "./types.js";

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
