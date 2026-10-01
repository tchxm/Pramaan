/**
 * Provider-agnostic LLM client interface. Spec Section 14.2 (`LLMClient`),
 * 14.4 (how the agent loop calls `complete`), 14.7 (the `completeJson`
 * semantic sub-call), 6 and 6.1 (technology stack / environment variables).
 *
 * This interface is the contract the agent loop (owned by A6b, in
 * `loop.ts`/`runAudit.ts`) is built against. Keep it stable: additive
 * changes only once other code depends on it.
 */

/** A single tool the model may call this turn. `inputSchema` is JSON Schema
 * (derived by the tools layer from each tool's zod schema). */
export interface LLMToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** One message in the running conversation sent to `complete`. */
export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Present on role:"tool" messages: the id of the tool call this is a result for. */
  toolCallId?: string;
  /** Present on role:"tool" messages: the name of the tool that was called. */
  toolName?: string;
}

/** A tool call the model made during a `complete` turn. */
export interface LLMToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** The normalized result of one `complete` call, independent of provider. */
export interface LLMResponse {
  /** The model's natural-language reasoning/response text. May be empty if
   * the model only called tools this turn. */
  text: string;
  /** Empty array if the model made no tool call this turn. */
  toolCalls: LLMToolCall[];
  stopReason: "tool_use" | "end_turn" | "max_tokens" | "error";
  /** The raw provider response, for debugging/trace. Never shown to the user as-is. */
  raw?: unknown;
}

export interface LLMCompleteOptions {
  /** Default 0 (spec: deterministic remediation). */
  temperature?: number;
  /** Default 30000 (spec 6.1: `PRAMAAN_LLM_TIMEOUT_MS`). */
  timeoutMs?: number;
  /** Default 4096. */
  maxTokens?: number;
}

export interface LLMClient {
  /** Full tool-use turn: the agent loop's main call (spec 14.4). */
  complete(
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    options?: LLMCompleteOptions,
  ): Promise<LLMResponse>;

  /**
   * Simple JSON-only completion for `semantic.inspect` (spec 14.7). No
   * tools; the model is expected to return strict JSON as its entire
   * response text. This method does not parse or validate the JSON — it
   * just returns the raw text. Parsing, the "retry once, then
   * E_LLM_BAD_OUTPUT" policy, and throwing LLMBadOutputError are the
   * caller's (semantic.inspect's) responsibility, per spec 14.7.
   */
  completeJson(
    systemPrompt: string,
    userPrompt: string,
    options?: LLMCompleteOptions,
  ): Promise<{ raw: string }>;
}

/** Thrown when a `complete`/`completeJson` call exceeds `timeoutMs`. */
export class LLMTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMTimeoutError";
  }
}

/** Thrown when every configured provider failed or none is configured. */
export class LLMUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMUnavailableError";
  }
}

/**
 * Not thrown by anything in this package. Documented here because spec
 * 14.7 names it: when `completeJson`'s output fails to parse as the
 * expected JSON shape twice (first attempt + one retry), the CALLER
 * (semantic.inspect, owned by A6b) throws this with code `E_LLM_BAD_OUTPUT`.
 * It lives in this module purely so the type is co-located with the rest
 * of the LLM error vocabulary and importable from one place.
 */
export class LLMBadOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMBadOutputError";
  }
}
