import { it, expect } from "vitest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { hashFile, verifyEvidencePack } from "@pramaan/core";
import { runAudit } from "../src/runAudit.js";
import { MittiMartDemoClient } from "../src/llm/mittiMartDemo.js";
import { isolatedFixtureCopy, makeTestIO, newAuditId } from "./helpers.js";

it("runs one complete fix, one proposal-only stop, and two stops without proposals through the real engine", async () => {
  const root = await isolatedFixtureCopy("f06-mitti-mart");
  const original = await readFile(path.join(root, "src/pages/Cart.tsx"), "utf8");
  const auditId = newAuditId(); const io = makeTestIO();
  const previousRuntime = process.env.PRAMAAN_RUNTIME;
  try {
    const audit = await runAudit({ projectRoot: root, configPath: path.join(root, "pramaan.config.json"), auditId,
      runtimeEnabled: true, mode: "replay", llmClient: new MittiMartDemoClient(0) }, io);
    expect(audit.before.total).toBe(4);
    expect(audit.after?.total).toBe(3);
    expect(audit.status).toBe("completed_with_failures");
    expect(audit.findings.find(f => f.ruleId === "PRM-001")?.status).toBe("verified");
    const proposals = io.events.filter(e => e.type === "tool.result" && e.payload.name === "patch.propose").map(e => (e.payload.result as any).data);
    expect(proposals).toHaveLength(2);
    const applied = io.events.filter(e => e.type === "patch.applied");
    expect(applied).toHaveLength(1);
    const verify = io.events.find(e => e.type === "verify.result")?.payload.result as any;
    expect(verify.verdict).toBe("VERIFIED");
    expect(verify.gates.map((g: any) => g.status)).toEqual(["pass", "pass", "pass", "pass", "pass"]);
    for (const rule of ["PRM-003", "PRM-004"]) expect(proposals.some(p => p.findingId === audit.findings.find(f => f.ruleId === rule)?.findingId)).toBe(false);
    const report = io.events.find(e => e.type === "evidence.generated")!;
    const pack = JSON.parse(await readFile(report.payload.packPath as string, "utf8"));
    expect(pack.llm.mode).toBe("replay");
    expect((await verifyEvidencePack(pack)).valid).toBe(true);
    const cartHash = pack.files.find((f: any) => f.path === "src/pages/Cart.tsx");
    expect(cartHash.sha256Before).not.toBe(cartHash.sha256After);
    expect(cartHash.sha256After).toBe(await hashFile(path.join(root, ".pramaan/workspaces", auditId, "src/pages/Cart.tsx")));
    const cart = await readFile(path.join(root, ".pramaan/workspaces", auditId, "src/pages/Cart.tsx"), "utf8");
    expect(cart).toContain("useState(false)");
    expect(cart).toContain("Offer expires in"); // Proposal-only timer fix was never applied.
    expect(await readFile(path.join(root, "src/pages/Cart.tsx"), "utf8")).toBe(original);
  } finally {
    if (previousRuntime === undefined) delete process.env.PRAMAAN_RUNTIME;
    else process.env.PRAMAAN_RUNTIME = previousRuntime;
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
