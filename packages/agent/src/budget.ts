// Budget tracking — Spec Section 14.6. Hard engine-enforced limits, never
// left to LLM self-restraint (I-11). `attemptsByFinding` is intentionally
// the SAME Map instance that gets handed to `@pramaan/core`'s
// `PolicyContext.attemptsByFinding` so both stay in sync automatically:
// `applyPatch()` increments it internally on every apply (success or
// rollback), and this module just reads it back.

export interface Budget {
  toolCalls: number;
  readonly maxToolCalls: number;
  readonly attemptsByFinding: Map<string, number>;
  readonly maxAttempts: number;
  readonly wallClockStartMs: number;
  readonly maxWallClockMs: number;
}

export interface CreateBudgetOptions {
  maxToolCalls?: number;
  maxAttempts?: number;
  maxWallClockMs?: number;
  /** Share an existing map (e.g. the one also given to PolicyContext). */
  attemptsByFinding?: Map<string, number>;
  nowMs?: number;
}

export const DEFAULT_MAX_TOOL_CALLS = 60;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_MAX_WALL_CLOCK_MS = 15 * 60 * 1000;

export function createBudget(opts: CreateBudgetOptions = {}): Budget {
  return {
    toolCalls: 0,
    maxToolCalls: opts.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS,
    attemptsByFinding: opts.attemptsByFinding ?? new Map<string, number>(),
    maxAttempts: opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    wallClockStartMs: opts.nowMs ?? Date.now(),
    maxWallClockMs: opts.maxWallClockMs ?? DEFAULT_MAX_WALL_CLOCK_MS,
  };
}

export function recordToolCall(budget: Budget): void {
  budget.toolCalls += 1;
}

export function isToolBudgetExhausted(budget: Budget): boolean {
  return budget.toolCalls >= budget.maxToolCalls;
}

export function isWallClockExhausted(budget: Budget, nowMs: number = Date.now()): boolean {
  return nowMs - budget.wallClockStartMs >= budget.maxWallClockMs;
}

export function attemptsUsed(budget: Budget, findingId: string): number {
  return budget.attemptsByFinding.get(findingId) ?? 0;
}

export function attemptsRemaining(budget: Budget, findingId: string): number {
  return Math.max(0, budget.maxAttempts - attemptsUsed(budget, findingId));
}

export function isAttemptsExhausted(budget: Budget, findingId: string): boolean {
  return attemptsUsed(budget, findingId) >= budget.maxAttempts;
}
