import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { canonicalJson } from "../src/evidence/canonical.js";
import { DISCLAIMER, verifyEvidencePack } from "../src/evidence/pack.js";
import { renderReportHtml, escapeHtml } from "../src/evidence/report/index.html.js";
import { renderReadmeTxt } from "../src/evidence/report/readme.js";
import { writeReportBundle } from "../src/evidence/report/writeReportBundle.js";
import type {
  ApprovalRequest,
  EvidencePack,
  Finding,
  PatchProposal,
  PatchResult,
  TraceEvent,
  VerifyResult,
} from "../src/types.js";

// ---------- build a realistic pack by hand, shaped like fixtures/f01-basket-simple ----------

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    findingId: "F-PRM-001-1",
    ruleId: "PRM-001",
    pattern: "BASKET_SNEAKING",
    severity: "high",
    status: "verified",
    detector: "AST",
    location: {
      file: "src/pages/Cart.tsx",
      startLine: 12,
      startColumn: 4,
      endLine: 12,
      endColumn: 78,
    },
    fingerprint: "a".repeat(64),
    title: "Delivery Protection checkbox defaults to checked",
    evidence: {
      sourceSnippet:
        'const [protection, setProtection] = useState(true);\n<label><input type="checkbox" checked={protection} onChange={...} /> Delivery Protection — ₹49</label>',
      fileSha256: "b".repeat(64),
      observed: { initialState: true },
      warnings: [],
    },
    signals: [
      { id: "S1_INITIAL_STATE_TRUE", fired: true, weight: 0.6, observed: { value: true } },
      { id: "S2_PRICE_NEARBY", fired: true, weight: 0.4, observed: { amount: 49, currency: "INR" } },
    ],
    score: 1,
    requiresReview: false,
    regulation: [
      {
        jurisdiction: "IN",
        framework: "Consumer Protection (E-Commerce) Rules, 2020",
        patternName: "Basket sneaking",
        auditDuty: "Rule 4(15) — no pre-ticked options that add cost without consent.",
        plainBasis:
          "Pre-selected add-ons that increase the price at checkout without explicit consent are a prohibited dark pattern under Rule 4(15).",
        verifiedAgainstGazette: false,
      },
    ],
    attempts: 1,
    ...overrides,
  };
}

function makeProposal(): PatchProposal {
  return {
    proposalId: "P-1",
    findingId: "F-PRM-001-1",
    strategy: "checkbox.default_off",
    rationale: "Set the checkbox's initial state literal to false so it is not pre-selected.",
    ops: [
      {
        opId: "OP-1",
        kind: "SET_INITIAL_STATE_LITERAL",
        file: "src/pages/Cart.tsx",
        target: { fingerprint: "a".repeat(64) },
        params: { value: false },
      },
    ],
    risk: "deterministic",
    requiresApproval: false,
  };
}

function makeResult(): PatchResult {
  return {
    proposalId: "P-1",
    applied: true,
    filesChanged: ["src/pages/Cart.tsx"],
    diff:
      "--- a/src/pages/Cart.tsx\n+++ b/src/pages/Cart.tsx\n@@ -1,2 +1,2 @@\n-const [protection, setProtection] = useState(true);\n+const [protection, setProtection] = useState(false);\n",
    policyViolations: [],
  };
}

function makeVerify(): VerifyResult {
  return {
    findingId: "F-PRM-001-1",
    fingerprint: "a".repeat(64),
    verdict: "VERIFIED",
    gates: [
      { gate: "G1_DETECTOR_CLEAR", status: "pass", details: {} },
      { gate: "G2_PRESERVATION", status: "pass", details: {} },
      { gate: "G3_BUILD", status: "pass", details: {} },
      { gate: "G4_RUNTIME", status: "pass", details: { computedOpacity: 1 } },
      { gate: "G5_NO_REGRESSION", status: "pass", details: {} },
    ],
    failureReasons: [],
    engineVersion: "0.1.0",
    verifiedAt: "2026-09-30T10:00:00.000Z",
  };
}

function makeApproval(): ApprovalRequest {
  return {
    approvalId: "A-1",
    findingId: "F-PRM-001-1",
    proposalId: "P-1",
    kind: "deterministic_preview",
    original: "checked={protection}",
    proposed: "checked={protection} (default false)",
    reason: "Preview of deterministic fix before apply.",
    status: "approved",
    resolvedAt: "2026-09-30T09:59:00.000Z",
  };
}

function makeTraceEvents(): TraceEvent[] {
  const events: Omit<TraceEvent, "hash">[] = [
    { seq: 1, ts: "2026-09-30T09:00:00.000Z", type: "audit.started", actor: "engine", payload: { auditId: "PRM-2026-000123" }, prevHash: "0".repeat(64) },
    { seq: 2, ts: "2026-09-30T09:01:00.000Z", type: "scan.completed", actor: "engine", payload: { findings: 1 }, prevHash: "" },
    { seq: 3, ts: "2026-09-30T09:02:00.000Z", type: "agent.plan", actor: "agent", payload: { strategy: "checkbox.default_off" }, prevHash: "" },
    { seq: 4, ts: "2026-09-30T09:05:00.000Z", type: "approval.resolved", actor: "human", payload: { approvalId: "A-1", decision: "approved" }, prevHash: "" },
  ];
  const chained: TraceEvent[] = [];
  let prev = "0".repeat(64);
  for (const ev of events) {
    const withPrev = { ...ev, prevHash: prev };
    const hash = createHash("sha256").update(withPrev.prevHash + canonicalJson({ seq: withPrev.seq, ts: withPrev.ts, type: withPrev.type, actor: withPrev.actor, payload: withPrev.payload })).digest("hex");
    const full: TraceEvent = { ...withPrev, hash };
    chained.push(full);
    prev = hash;
  }
  return chained;
}

function buildPack(finding: Finding, traceHead: string): EvidencePack {
  const withoutHash: Omit<EvidencePack, "evidenceHash"> = {
    schema: "pramaan.evidence/1",
    audit: {
      auditId: "PRM-2026-000123",
      projectName: "basket-simple-fixture",
      startedAt: "2026-09-30T09:00:00.000Z",
      completedAt: "2026-09-30T09:10:00.000Z",
      engineVersion: "0.1.0",
      configHash: "c".repeat(64),
      filesScanned: 4,
      before: { total: 1, high: 1, medium: 0, low: 0 },
      after: { total: 0, high: 0, medium: 0, low: 0 },
      findings: [finding],
      status: "completed",
    },
    engine: { version: "0.1.0", node: process.version, playwright: "1.46.0", regulationDataVersion: "2026.1" },
    llm: { provider: "anthropic", model: "claude-sonnet-5", temperature: 0, mode: "replay" },
    config: { rules: ["PRM-001"] },
    files: [{ path: "src/pages/Cart.tsx", sha256Before: "b".repeat(64), sha256After: "d".repeat(64) }],
    findings: [
      {
        finding,
        proposals: [{ proposal: makeProposal(), result: makeResult(), verify: makeVerify() }],
        approvals: [makeApproval()],
      },
    ],
    artifacts: [],
    traceHead,
    disclaimer: DISCLAIMER,
    generatedAt: "2026-09-30T09:10:00.000Z",
  };
  const evidenceHash = createHash("sha256").update(canonicalJson(withoutHash)).digest("hex");
  return { ...withoutHash, evidenceHash };
}

describe("renderReportHtml", () => {
  const finding = makeFinding();
  const traceEvents = makeTraceEvents();
  const pack = buildPack(finding, traceEvents.at(-1)!.hash);

  it("contains the audit id, finding title, regulation basis, disclaimer and evidence hash", () => {
    const html = renderReportHtml(pack, traceEvents);
    expect(html).toContain(pack.audit.auditId);
    expect(html).toContain(finding.title);
    expect(html).toContain(finding.regulation[0].plainBasis);
    expect(html).toContain(DISCLAIMER);
    expect(html).toContain(pack.evidenceHash);
    expect(html).toContain("Reference not yet checked against the gazette");
    expect(html).toContain("Verdicts come from the deterministic engine, not the model.");
    expect(html).toContain("Fixed and verified");
    // screenshot references are relative paths, not inlined data
    expect(html).toContain(`./screenshots/${finding.findingId}-before.png`);
    expect(html).toContain(`./screenshots/${finding.findingId}-after.png`);
    expect(html).not.toContain("data:image");
    // trace timeline present
    expect(html).toContain("agent.plan");
    expect(html).toContain("approval.resolved");
    // no external CDN references
    expect(html).not.toMatch(/https?:\/\//);
    expect(html.startsWith("<!doctype html>")).toBe(true);
  });

  it("escapes HTML-unsafe characters from a helper", () => {
    expect(escapeHtml(`<script>alert(1)</script>`)).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(escapeHtml(`a & b "c" 'd'`)).toBe("a &amp; b &quot;c&quot; &#39;d&#39;");
  });

  it("HTML-escapes untrusted scanned-source content (XSS)", () => {
    const malicious = makeFinding({
      findingId: "F-PRM-001-2",
      title: '<script>alert(1)</script> injected title',
      evidence: {
        sourceSnippet: '<img src=x onerror="alert(2)">',
        fileSha256: "e".repeat(64),
        observed: { note: "<script>alert(3)</script>" },
        warnings: [],
      },
      signals: [
        {
          id: "S1",
          fired: true,
          weight: 0.5,
          observed: { raw: "<script>alert(4)</script>" },
        },
      ],
    });
    const maliciousPack = buildPack(malicious, traceEvents.at(-1)!.hash);
    const html = renderReportHtml(maliciousPack, traceEvents);

    // The escaped form must be present...
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(2)&quot;&gt;");
    expect(html).toContain("&lt;script&gt;alert(3)&lt;/script&gt;");
    expect(html).toContain("&lt;script&gt;alert(4)&lt;/script&gt;");

    // ...and a literal unescaped <script> tag injected by the finding data
    // must never appear anywhere in the output.
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<script>alert(3)</script>");
    expect(html).not.toContain("<script>alert(4)</script>");
    expect(html).not.toContain('<img src=x onerror="alert(2)">');
  });

  it("renders gracefully with no trace events", () => {
    const html = renderReportHtml(pack);
    expect(html).toContain(pack.audit.auditId);
    expect(html).toContain("No trace events were provided");
  });
});

describe("renderReadmeTxt", () => {
  it("includes verify instructions, hash, and honest limits", () => {
    const finding = makeFinding();
    const traceEvents = makeTraceEvents();
    const pack = buildPack(finding, traceEvents.at(-1)!.hash);
    const readme = renderReadmeTxt(pack);
    expect(readme).toContain(pack.audit.auditId);
    expect(readme).toContain("pramaan evidence verify");
    expect(readme).toContain(pack.evidenceHash);
    expect(readme).toContain(DISCLAIMER);
    expect(readme).toContain("unsigned");
    expect(readme).toContain("local clock");
  });
});

describe("writeReportBundle", () => {
  it("writes real files to disk and round-trips through verifyEvidencePack", async () => {
    const finding = makeFinding();
    const traceEvents = makeTraceEvents();
    const pack = buildPack(finding, traceEvents.at(-1)!.hash);

    const dir = await mkdtemp(path.join(tmpdir(), "pramaan-report-test-"));
    try {
      const outDir = path.join(dir, "pramaan-report", pack.audit.auditId);
      const result = await writeReportBundle(pack, traceEvents, outDir);

      const indexStat = await stat(result.indexPath);
      const packStat = await stat(result.packPath);
      const readmeStat = await stat(result.readmePath);
      expect(indexStat.size).toBeGreaterThan(0);
      expect(packStat.size).toBeGreaterThan(0);
      expect(readmeStat.size).toBeGreaterThan(0);

      expect(result.tracePath).not.toBeNull();
      const traceContent = await readFile(result.tracePath!, "utf8");
      const lines = traceContent.trim().split("\n");
      expect(lines).toHaveLength(traceEvents.length);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }

      const writtenPackRaw = await readFile(result.packPath, "utf8");
      const writtenPack = JSON.parse(writtenPackRaw) as EvidencePack;
      const verifyResult = await verifyEvidencePack(writtenPack, { traceEvents });
      expect(verifyResult.valid).toBe(true);
      expect(verifyResult.checks.every((c) => c.passed)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("omits trace.jsonl when no traceEvents are given", async () => {
    const finding = makeFinding();
    const pack = buildPack(finding, "0".repeat(64));
    const dir = await mkdtemp(path.join(tmpdir(), "pramaan-report-test-notrace-"));
    try {
      const outDir = path.join(dir, "pramaan-report", pack.audit.auditId);
      const result = await writeReportBundle(pack, undefined, outDir);
      expect(result.tracePath).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
