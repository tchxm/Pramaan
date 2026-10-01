import { expect, it } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { runAudit } from "../src/runAudit.js";
import { LLMUnavailableError } from "../src/llm/client.js";
import { isolatedFixtureCopy, makeTestIO, newAuditId } from "./helpers.js";

it("retains real scan findings but never marks an unavailable-agent audit complete", async () => {
  const root = await isolatedFixtureCopy("f01-basket-simple");
  try {
    const io = makeTestIO();
    const audit = await runAudit({ projectRoot: root, configPath: path.join(root, "pramaan.config.json"), auditId: newAuditId(), llmClient: { async complete() { throw new LLMUnavailableError("Provider is unavailable"); }, async completeJson() { throw new LLMUnavailableError("Provider is unavailable"); } } }, io);
    expect(audit.status).toBe("error");
    expect(audit.findings).toHaveLength(1);
    expect(audit.findings[0].status).toBe("open");
    expect(audit.after?.total).toBe(1);
    expect(io.events.some(e => e.type === "evidence.generated")).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30000);

it("keeps provider failure as the cause when its request also crosses the wall-clock limit", async () => {
  const root = await isolatedFixtureCopy("f01-basket-simple");
  try {
    const unavailable = async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
      throw new LLMUnavailableError("Provider is unavailable");
    };
    const audit = await runAudit({ projectRoot: root, configPath: path.join(root, "pramaan.config.json"), auditId: newAuditId(), maxWallClockMs: 20, llmClient: { complete: unavailable, completeJson: unavailable } }, makeTestIO());
    expect(audit.status).toBe("error");
    expect(audit.findings[0].failure?.code).not.toBe("BUDGET_EXHAUSTED");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30000);
