/**
 * Provider tool-name APIs (Anthropic, OpenAI-compatible/Groq) require
 * `^[a-zA-Z0-9_-]{1,128}$` — no dots. Our internal tool registry (spec 14.2)
 * is keyed by dotted names (`detector.verify`, `patch.apply`, ...) because
 * that's the readable form used throughout the codebase and traces. Adapters
 * translate at the wire boundary only: dots <-> double-underscore, which is
 * reversible since no internal tool name already contains "__".
 */
export function toApiToolName(name: string): string {
  return name.replace(/\./g, "__");
}

export function fromApiToolName(name: string): string {
  return name.replace(/__/g, ".");
}
