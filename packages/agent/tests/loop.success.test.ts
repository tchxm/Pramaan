// Full success path: propose -> apply -> verify -> VERIFIED/STATIC_VERIFIED
// for every finding, ending with Audit.after.total === 0 and
// status === "completed". A reduced stand-in for the full F06 (4-finding)
// replay scenario described in the brief — see KNOWN RISKS in the handoff
// for why f06-mitti-mart's full 4-pattern walk wasn't also scripted (time).
// PRAMAAN_RUNTIME=off, so the real G4 gate reports `not_run` and the
// terminal verdict is STATIC_VERIFIED rather than VERIFIED — still a real,
// engine-computed verdict, never read from model text.

import { describe, expect, it, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { MockLLMClient } from "../src/llm/mock.js";
import { runAudit } from "../src/runAudit.js";
import { isolatedFixtureCopy, makeTestIO, newAuditId } from "./helpers.js";
import type { LLMResponse } from "../src/llm/client.js";
import type { Audit } from "@pramaan/core";

const cleanupDirs: string[] = [];
afterEach(async () => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("full success path", () => {
  it("drives a finding through propose -> apply -> verify -> STATIC_VERIFIED and reaches audit.after.total === 0", async () => {
    const projectRoot = await isolatedFixtureCopy("f01-basket-simple");
    cleanupDirs.push(projectRoot);
    const configPath = path.join(projectRoot, "pramaan.config.json");
    const auditId = newAuditId();
    const io = makeTestIO();
    const progress: Audit[] = [];
    io.onAuditUpdate = audit => progress.push(structuredClone(audit));

    let findingId = "";

    const llm = new MockLLMClient({
      responder: (messages, _tools, callIndex) => {
        if (callIndex === 0) {
          expect(progress[0]?.findings).toHaveLength(1);
          expect(progress[0]?.status).toBe("running");
          const userMsg = messages.find((m) => m.role === "user");
          const parsed = JSON.parse(userMsg?.content ?? "{}") as { findings: { findingId: string }[] };
          findingId = parsed.findings[0]?.findingId ?? "";
          const resp: LLMResponse = {
            text: "proposing the least-invasive fix",
            toolCalls: [{ id: "call-0", name: "patch.propose", input: { findingId, strategy: "checkbox.default_off" } }],
            stopReason: "tool_use",
          };
          return resp;
        }
        const lastTool = [...messages].reverse().find((m) => m.role === "tool");
        const lastResult = lastTool ? (JSON.parse(lastTool.content) as { ok: boolean; data?: unknown }) : null;

        if (lastTool?.toolName === "patch.propose" && lastResult?.ok) {
          const proposalId = (lastResult.data as { proposalId: string }).proposalId;
          const resp: LLMResponse = {
            text: "applying",
            toolCalls: [{ id: `call-${callIndex}`, name: "patch.apply", input: { proposalId } }],
            stopReason: "tool_use",
          };
          return resp;
        }
        if (lastTool?.toolName === "patch.apply") {
          const resp: LLMResponse = {
            text: "verifying",
            toolCalls: [{ id: `call-${callIndex}`, name: "detector.verify", input: { findingId } }],
            stopReason: "tool_use",
          };
          return resp;
        }
        return { text: "all findings resolved", toolCalls: [], stopReason: "end_turn" };
      },
    });

    const audit = await runAudit(
      { projectRoot, configPath, auditId, maxToolCalls: 60, maxAttemptsPerFinding: 3, runtimeEnabled: false, mode: "live", llmClient: llm },
      io,
    );

    const finding = audit.findings.find((f) => f.findingId === findingId);
    expect(["verified", "static_verified"]).toContain(finding?.status);
    expect(audit.after?.total).toBe(0);
    expect(audit.status).toBe("completed");

    const verifyEvents = io.events.filter((e) => e.type === "verify.result");
    expect(verifyEvents.length).toBeGreaterThan(0);
    const last = verifyEvents.at(-1);
    expect(["VERIFIED", "STATIC_VERIFIED"]).toContain((last?.payload as { result: { verdict: string } }).result.verdict);

    const evidenceEvents = io.events.filter((e) => e.type === "evidence.generated");
    expect(evidenceEvents.length).toBe(1);
  }, 60_000);
});
