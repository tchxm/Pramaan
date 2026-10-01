import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendEvent, buildEvidencePack, GENESIS_HASH, type Audit } from "@pramaan/core";
import { runEvidenceVerify } from "./evidence.js";

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

function buildRealPack() {
  const audit: Audit = {
    auditId: "PRM-2026-000001",
    projectName: "test",
    startedAt: new Date().toISOString(),
    engineVersion: "0.1.0",
    configHash: "abc",
    filesScanned: 1,
    before: { total: 0, high: 0, medium: 0, low: 0 },
    findings: [],
    status: "completed",
  };
  const e1 = appendEvent(GENESIS_HASH, {
    seq: 1,
    ts: new Date().toISOString(),
    type: "audit.started",
    actor: "engine",
    payload: {},
  });
  const trace = `${JSON.stringify(e1)}\n`;
  const pack = buildEvidencePack({
    audit,
    engine: { version: "0.1.0", node: process.version, playwright: "x", regulationDataVersion: "india-1" },
    llm: { provider: "anthropic", model: "unset", temperature: 0, mode: "live" },
    config: {},
    files: [],
    findings: [],
    artifacts: [],
    traceHead: e1.hash,
  });
  return { pack, trace };
}

describe("pramaan evidence verify <path>", () => {
  it("exits 0 for a valid, untampered pack", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "pramaan-cli-evidence-"));
    const { pack, trace } = buildRealPack();
    await writeFile(path.join(tmpDir, "evidence.json"), JSON.stringify(pack), "utf-8");
    await writeFile(path.join(tmpDir, "trace.jsonl"), trace, "utf-8");

    const code = await runEvidenceVerify(path.join(tmpDir, "evidence.json"));
    expect(code).toBe(0);
  });

  it("exits 1 for a tampered pack", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "pramaan-cli-evidence-tampered-"));
    const { pack, trace } = buildRealPack();
    const tampered = { ...pack, audit: { ...pack.audit, status: "completed_with_failures" } };
    await writeFile(path.join(tmpDir, "evidence.json"), JSON.stringify(tampered), "utf-8");
    await writeFile(path.join(tmpDir, "trace.jsonl"), trace, "utf-8");

    const code = await runEvidenceVerify(path.join(tmpDir, "evidence.json"));
    expect(code).toBe(1);
  });

  it("exits 2 when the pack file cannot be read", async () => {
    const code = await runEvidenceVerify("/does/not/exist/evidence.json");
    expect(code).toBe(2);
  });
});
