// T-AG-09 — Spec 14.3 state machine / 12.4 P10 (attempts-exhausted). Forces
// three genuine FAILED verdicts from the real `verifyFinding` engine (by
// configuring a build command that always fails, so gate G3 never passes
// regardless of the patch), then asserts the finding is escalated to
// "failed" after exactly 3 attempts and a 4th propose/apply never happens
// because the loop sees the finding as terminal and stops on its own.

import { describe, expect, it, afterEach } from "vitest";
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { MockLLMClient } from "../src/llm/mock.js";
import { runAudit } from "../src/runAudit.js";
import { isolatedFixtureCopy, makeTestIO, newAuditId } from "./helpers.js";
import type { LLMResponse, LLMToolCall } from "../src/llm/client.js";

const cleanupDirs: string[] = [];
afterEach(async () => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("T-AG-09: attempts-exhausted escalation", () => {
  it("escalates to failed after exactly 3 failed attempts, never a 4th", async () => {
    const projectRoot = await isolatedFixtureCopy("f01-basket-simple");
    cleanupDirs.push(projectRoot);
    const configPath = path.join(projectRoot, "pramaan.config.json");

    // Force G3 (build) to fail deterministically every time, regardless of
    // whether the patch itself is correct — isolates this test from needing
    // to know which strategy "really" fixes the fixture, and guarantees a
    // real FAILED VerifyResult from the engine's own gate logic (not a
    // scripted one).
    const raw = JSON.parse(await readFile(configPath, "utf-8"));
    raw.runtime = { ...raw.runtime, buildCommand: 'node -e "process.exit(1)"' };
    await writeFile(configPath, JSON.stringify(raw, null, 2), "utf-8");

    const auditId = newAuditId();
    const io = makeTestIO();

    let findingId = "";
    const proposalIds: string[] = [];
    let attempt = 0;

    const llm = new MockLLMClient({
      responder: (messages, _tools, callIndex) => {
        if (callIndex === 0) {
          // Discover the findingId from the initial user summary message.
          const userMsg = messages.find((m) => m.role === "user");
          const parsed = JSON.parse(userMsg?.content ?? "{}") as { findings: { findingId: string }[] };
          findingId = parsed.findings[0]?.findingId ?? "";
          return proposeCall(findingId, callIndex);
        }

        // Inspect the last tool message to decide the next step.
        const lastTool = [...messages].reverse().find((m) => m.role === "tool");
        const lastResult = lastTool ? (JSON.parse(lastTool.content) as { ok: boolean; data?: unknown }) : null;
        const lastToolName = lastTool?.toolName;

        if (lastToolName === "patch.propose" && lastResult?.ok) {
          const proposalId = (lastResult.data as { proposalId: string }).proposalId;
          proposalIds.push(proposalId);
          return applyCall(proposalId, callIndex);
        }
        if (lastToolName === "patch.apply") {
          return verifyCall(findingId, callIndex);
        }
        if (lastToolName === "detector.verify") {
          attempt += 1;
          if (attempt >= 3) {
            // Finding should already be terminal now; stop making tool calls.
            return { text: "attempts exhausted, stopping", toolCalls: [], stopReason: "end_turn" as const };
          }
          return proposeCall(findingId, callIndex);
        }
        return { text: "done", toolCalls: [], stopReason: "end_turn" as const };
      },
    });

    function proposeCall(fid: string, callIndex: number): LLMResponse {
      const call: LLMToolCall = { id: `call-${callIndex}`, name: "patch.propose", input: { findingId: fid, strategy: "checkbox.default_off" } };
      return { text: "proposing a fix", toolCalls: [call], stopReason: "tool_use" };
    }
    function applyCall(proposalId: string, callIndex: number): LLMResponse {
      const call: LLMToolCall = { id: `call-${callIndex}`, name: "patch.apply", input: { proposalId } };
      return { text: "applying the fix", toolCalls: [call], stopReason: "tool_use" };
    }
    function verifyCall(fid: string, callIndex: number): LLMResponse {
      const call: LLMToolCall = { id: `call-${callIndex}`, name: "detector.verify", input: { findingId: fid } };
      return { text: "verifying", toolCalls: [call], stopReason: "tool_use" };
    }

    const audit = await runAudit(
      { projectRoot, configPath, auditId, maxToolCalls: 60, maxAttemptsPerFinding: 3, runtimeEnabled: false, mode: "live", llmClient: llm },
      io,
    );

    const applyEvents = io.events.filter((e) => e.type === "agent.tool_call" && (e.payload as { name: string }).name === "patch.apply");
    expect(applyEvents.length).toBe(3);

    const verifyEvents = io.events.filter((e) => e.type === "verify.result");
    expect(verifyEvents.length).toBe(3);
    for (const e of verifyEvents) {
      expect((e.payload as { result: { verdict: string } }).result.verdict).toBe("FAILED");
    }

    const finding = audit.findings.find((f) => f.findingId === findingId);
    expect(finding?.status).toBe("failed");
    expect(finding?.attempts).toBe(3);
    expect(audit.status).toBe("completed_with_failures");
  }, 60_000);
});
