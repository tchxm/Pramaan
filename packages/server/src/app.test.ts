import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendEvent, buildEvidencePack, GENESIS_HASH, type Audit } from "@pramaan/core";
import { buildApp } from "./app.js";
import { AuditStore } from "./store.js";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "pramaan-server-test-"));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("GET /api/health", () => {
  it("returns the spec 17.1 shape", async () => {
    const app = await buildApp({ store: new AuditStore(tmpRoot) });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ok: true });
    expect(body.llm).toHaveProperty("configured");
    expect(body.runtime).toHaveProperty("playwrightReady");
    expect(body).toHaveProperty("mode");
  });
});

describe("POST /api/audits — path confinement", () => {
  it("rejects .. traversal with 400 E_BAD_INPUT", async () => {
    const app = await buildApp({ store: new AuditStore(tmpRoot) });
    const res = await app.inject({
      method: "POST",
      url: "/api/audits",
      payload: { source: { type: "path", path: "../../etc/passwd" } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("E_BAD_INPUT");
  });

  it("rejects paths outside PRAMAAN_ALLOWED_ROOTS with 400 E_BAD_INPUT", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "pramaan-outside-"));
    const prevRoots = process.env.PRAMAAN_ALLOWED_ROOTS;
    process.env.PRAMAAN_ALLOWED_ROOTS = tmpRoot;
    try {
      const app = await buildApp({ store: new AuditStore(tmpRoot) });
      const res = await app.inject({
        method: "POST",
        url: "/api/audits",
        payload: { source: { type: "path", path: outside } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("E_BAD_INPUT");
    } finally {
      process.env.PRAMAAN_ALLOWED_ROOTS = prevRoots;
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("202s and records an error-status audit while runAudit() is unimplemented", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "pramaan-project-"));
    const prevRoots = process.env.PRAMAAN_ALLOWED_ROOTS;
    process.env.PRAMAAN_ALLOWED_ROOTS = projectDir;
    try {
      const app = await buildApp({ store: new AuditStore(tmpRoot) });
      const res = await app.inject({
        method: "POST",
        url: "/api/audits",
        payload: { source: { type: "path", path: projectDir } },
      });
      expect(res.statusCode).toBe(202);
      const { auditId } = res.json();
      expect(auditId).toMatch(/^PRM-\d{4}-\d{6}$/);

      // background run() is fire-and-forget; wait a tick for it to settle.
      await new Promise((r) => setTimeout(r, 50));

      const getRes = await app.inject({ method: "GET", url: `/api/audits/${auditId}` });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().audit.status).toBe("error");
    } finally {
      process.env.PRAMAAN_ALLOWED_ROOTS = prevRoots;
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});

describe("Approvals — resolving twice", () => {
  it("first resolution succeeds, second returns 409 E_STATE_CONFLICT", async () => {
    const store = new AuditStore(tmpRoot);
    const app = await buildApp({ store });
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "pramaan-approval-project-"));
    try {
      const auditId = await store.createAudit({ type: "path", path: projectDir }, {}, projectDir);
      const record = store.get(auditId)!;
      record.approvals.push({
        approvalId: "A-1",
        findingId: "F-PRM-001-1",
        proposalId: "P-1",
        kind: "deterministic_preview",
        original: "before",
        proposed: "after",
        reason: "test",
        status: "pending",
      });

      const first = await app.inject({
        method: "POST",
        url: `/api/audits/${auditId}/approvals/A-1`,
        payload: { decision: "approve" },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().approval.status).toBe("approved");

      const second = await app.inject({
        method: "POST",
        url: `/api/audits/${auditId}/approvals/A-1`,
        payload: { decision: "approve" },
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().error.code).toBe("E_STATE_CONFLICT");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});

describe("SSE reconnect — Last-Event-ID replay", () => {
  it("eventsAfter only returns events with seq greater than the given id", async () => {
    const store = new AuditStore(tmpRoot);
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "pramaan-sse-project-"));
    try {
      const auditId = await store.createAudit({ type: "path", path: projectDir }, {}, projectDir);
      // Let the background run()'s immediate "not implemented" error settle
      // (audit.started + error) before appending our own deterministic events.
      await new Promise((r) => setTimeout(r, 50));
      const baseSeq = store.eventsAfter(auditId, 0).at(-1)!.seq;

      await store.appendTrace(auditId, { type: "agent.plan", actor: "agent", payload: { step: 1 } });
      await store.appendTrace(auditId, { type: "agent.plan", actor: "agent", payload: { step: 2 } });
      await store.appendTrace(auditId, { type: "agent.plan", actor: "agent", payload: { step: 3 } });

      const all = store.eventsAfter(auditId, 0);
      expect(all.length).toBeGreaterThanOrEqual(baseSeq + 3);

      const afterBase = store.eventsAfter(auditId, baseSeq);
      expect(afterBase.every((e) => e.seq > baseSeq)).toBe(true);
      expect(afterBase.some((e) => e.payload.step === 3)).toBe(true);
      expect(afterBase.some((e) => e.payload.step === 1)).toBe(true);
      expect(afterBase.length).toBe(3);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("subscribe() only receives events appended after subscription", async () => {
    const store = new AuditStore(tmpRoot);
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "pramaan-sse-live-"));
    try {
      const auditId = await store.createAudit({ type: "path", path: projectDir }, {}, projectDir);
      // Let the background run()'s immediate "not implemented" error settle
      // before subscribing, so it doesn't race with our own events below.
      await new Promise((r) => setTimeout(r, 50));
      const received: number[] = [];
      const unsubscribe = store.subscribe(auditId, (event) => received.push(event.seq));
      await store.appendTrace(auditId, { type: "agent.plan", actor: "agent", payload: {} });
      await store.appendTrace(auditId, { type: "agent.plan", actor: "agent", payload: {} });
      unsubscribe();
      await store.appendTrace(auditId, { type: "agent.plan", actor: "agent", payload: {} });
      expect(received.length).toBe(2);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});

describe("POST /api/evidence/verify", () => {
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

  it("validates a real, untampered pack", async () => {
    const app = await buildApp({ store: new AuditStore(tmpRoot) });
    const { pack, trace } = buildRealPack();
    const res = await app.inject({ method: "POST", url: "/api/evidence/verify", payload: { pack, trace } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(true);
    expect(body.checks.every((c: { pass: boolean }) => c.pass)).toBe(true);
  });

  it("flags a tampered pack as invalid via evidence_hash mismatch", async () => {
    const app = await buildApp({ store: new AuditStore(tmpRoot) });
    const { pack, trace } = buildRealPack();
    const tampered = { ...pack, audit: { ...pack.audit, status: "completed_with_failures" } };
    const res = await app.inject({ method: "POST", url: "/api/evidence/verify", payload: { pack: tampered, trace } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(false);
    const hashCheck = body.checks.find((c: { name: string }) => c.name === "evidence_hash");
    expect(hashCheck.pass).toBe(false);
  });
});
