// T-AG-07 and T-AG-08 — Spec Section 14.4/14.6/I-11. Both prove the loop is
// structurally incapable of being talked into a verdict or of running past
// its hard budgets: the LLM has no way to set a finding's status, and the
// 60-tool-call cap is enforced by the engine (budget.ts / loop.ts), never
// by the mock "agreeing" to stop.

import { describe, expect, it, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { MockLLMClient } from "../src/llm/mock.js";
import { runAudit } from "../src/runAudit.js";
import { isolatedFixtureCopy, makeTestIO, newAuditId } from "./helpers.js";

const cleanupDirs: string[] = [];
afterEach(async () => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("T-AG-07: structural verdict integrity", () => {
  it("never marks a finding verified when the model only talks and never calls detector.verify", async () => {
    const projectRoot = await isolatedFixtureCopy("f01-basket-simple");
    cleanupDirs.push(projectRoot);
    const configPath = path.join(projectRoot, "pramaan.config.json");
    const auditId = newAuditId();
    const io = makeTestIO();

    const llm = new MockLLMClient({
      responder: (_messages, _tools, callIndex) => ({
        text: "looks fixed! the finding is resolved.",
        toolCalls: [{ id: `call-${callIndex}`, name: "project.list_files", input: {} }],
        stopReason: "tool_use",
      }),
    });

    const audit = await runAudit(
      { projectRoot, configPath, auditId, maxToolCalls: 60, maxAttemptsPerFinding: 3, runtimeEnabled: false, mode: "live", llmClient: llm },
      io,
    );

    expect(audit.findings.length).toBeGreaterThan(0);
    for (const finding of audit.findings) {
      expect(finding.status).not.toBe("verified");
      expect(finding.status).not.toBe("static_verified");
    }
    // detector.verify was never called — checked via trace events, which
    // is what the engine actually dispatched (the only source of truth).
    const verifyEvents = io.events.filter((e) => e.type === "verify.result");
    expect(verifyEvents.length).toBe(0);
    const toolCallEvents = io.events.filter((e) => e.type === "agent.tool_call");
    for (const e of toolCallEvents) {
      expect((e.payload as { name: string }).name).not.toBe("detector.verify");
    }
    expect(audit.status).toBe("completed_with_failures");
  }, 30_000);
});

describe("T-AG-08: tool-call budget is engine-enforced", () => {
  it("fails every non-terminal finding with BUDGET_EXHAUSTED after exactly 60 tool calls, set by the engine", async () => {
    const projectRoot = await isolatedFixtureCopy("f01-basket-simple");
    cleanupDirs.push(projectRoot);
    const configPath = path.join(projectRoot, "pramaan.config.json");
    const auditId = newAuditId();
    const io = makeTestIO();

    const llm = new MockLLMClient({
      responder: (_messages, _tools, callIndex) => ({
        text: "still investigating",
        toolCalls: [{ id: `call-${callIndex}`, name: "project.list_files", input: {} }],
        stopReason: "tool_use",
      }),
    });

    const audit = await runAudit(
      { projectRoot, configPath, auditId, maxToolCalls: 60, maxAttemptsPerFinding: 3, runtimeEnabled: false, mode: "live", llmClient: llm },
      io,
    );

    const toolCallEvents = io.events.filter((e) => e.type === "agent.tool_call");
    expect(toolCallEvents.length).toBe(60);

    expect(audit.findings.length).toBeGreaterThan(0);
    for (const finding of audit.findings) {
      expect(finding.status).toBe("failed");
      expect(finding.failure?.code).toBe("BUDGET_EXHAUSTED");
    }
    expect(audit.status).toBe("completed_with_failures");
  }, 30_000);
});
