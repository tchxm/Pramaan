// The agent loop — Spec Section 14.4 pseudocode, followed exactly. This is
// the ONLY place that calls `llm.complete()`; every tool choice each turn
// comes from the model's real response, never a `switch(finding.pattern)`
// dispatch (Section 10B "REAL TOOL-CHOICE REQUIREMENT"). The loop never
// reads a verdict from `reply.text` — only `detector.verify`'s real
// VerifyResult (inside detectorTools.ts's handler) ever changes
// `finding.status` to verified/static_verified/failed.

import type { LLMMessage } from "./llm/client.js";
import { SYSTEM_PROMPT } from "./prompts.js";
import { toolDefinitionsForLLM, dispatchToolCall } from "./tools/registry.js";
import { allFindingsTerminal, evidenceGenerateHandler } from "./tools/verifyTools.js";
import type { AgentToolContext } from "./tools/context.js";
import type { Budget } from "./budget.js";
import { isToolBudgetExhausted, isWallClockExhausted, recordToolCall } from "./budget.js";
import type { TraceEmitter } from "./trace.js";

const TERMINAL = new Set(["verified", "static_verified", "failed", "ignored"]);

function summarizeFindings(ctx: AgentToolContext): unknown {
  return {
    auditId: ctx.auditId,
    findings: [...ctx.findings.values()].map((f) => ({
      findingId: f.findingId,
      ruleId: f.ruleId,
      pattern: f.pattern,
      severity: f.severity,
      status: f.status,
      title: f.title,
      location: f.location,
      fingerprint: f.fingerprint,
    })),
  };
}

export interface LoopOutcome {
  stoppedReason: "all_terminal" | "tool_budget_exhausted" | "wall_clock_exhausted" | "llm_unavailable";
}

export async function runAgentLoop(
  ctx: AgentToolContext,
  budget: Budget,
  trace: TraceEmitter,
): Promise<LoopOutcome> {
  const tools = toolDefinitionsForLLM();
  const messages: LLMMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(summarizeFindings(ctx)) },
  ];

  let stoppedReason: LoopOutcome["stoppedReason"] = "all_terminal";

  while (!allFindingsTerminal(ctx) && !isToolBudgetExhausted(budget) && !isWallClockExhausted(budget)) {
    let reply;
    try {
      reply = await ctx.llmClient.complete(messages, tools, { temperature: 0, timeoutMs: 30_000 });
    } catch (cause) {
      trace.emit({
        type: "error",
        actor: "engine",
        payload: { message: cause instanceof Error ? cause.message : String(cause), code: "E_LLM_UNAVAILABLE" },
      });
      stoppedReason = "llm_unavailable";
      break;
    }

    trace.emit({ type: "agent.reason", actor: "agent", payload: { text: reply.text, stopReason: reply.stopReason } });
    messages.push({ role: "assistant", content: reply.text });

    if (reply.toolCalls.length === 0) {
      if (allFindingsTerminal(ctx)) break;
      const remaining = [...ctx.findings.values()].filter((f) => !TERMINAL.has(f.status)).map((f) => f.findingId);
      messages.push({
        role: "user",
        content: `Findings remain: ${remaining.join(", ")}. Continue or call finding.escalate.`,
      });
      continue;
    }

    for (const call of reply.toolCalls) {
      if (isToolBudgetExhausted(budget)) break;

      trace.emit({ type: "agent.tool_call", actor: "agent", payload: { callId: call.id, name: call.name, input: call.input } });
      const result = await dispatchToolCall(call.name, call.input, ctx);
      trace.emit({ type: "tool.result", actor: "engine", payload: { callId: call.id, name: call.name, result } });
      recordToolCall(budget);

      messages.push({
        role: "tool",
        toolCallId: call.id,
        toolName: call.name,
        content: JSON.stringify(result),
      });
    }
  }

  if (isWallClockExhausted(budget)) stoppedReason = "wall_clock_exhausted";
  else if (isToolBudgetExhausted(budget) && !allFindingsTerminal(ctx)) stoppedReason = "tool_budget_exhausted";

  // Budget enforcement is a deterministic ENGINE decision, never the LLM's
  // (I-11, Spec 14.4 "if budget exhausted: every non-terminal finding ->
  // failed with reason BUDGET_EXHAUSTED (engine sets, not the LLM)").
  if (stoppedReason === "tool_budget_exhausted" || stoppedReason === "wall_clock_exhausted") {
    for (const finding of ctx.findings.values()) {
      if (TERMINAL.has(finding.status)) continue;
      finding.status = "failed";
      finding.failure = {
        code: "BUDGET_EXHAUSTED",
        message:
          stoppedReason === "wall_clock_exhausted"
            ? "15-minute wall-clock audit budget exhausted before this finding reached a terminal state"
            : "60-tool-call audit budget exhausted before this finding reached a terminal state",
        data: { toolCalls: budget.toolCalls, maxToolCalls: budget.maxToolCalls },
      };
    }
  }

  // "evidence.generate() (engine, automatically if agent did not)" — Spec
  // 14.4 last line. Called directly (engine-triggered), not via the LLM.
  if (!ctx.evidenceResult) {
    await evidenceGenerateHandler({}, ctx);
  }

  return { stoppedReason };
}
