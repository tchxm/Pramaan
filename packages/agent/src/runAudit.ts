import path from "node:path";
import {
  loadConfig,
  createWorkspace,
  buildProjectModel,
  runDetectorsWithWarnings,
  findConfirmShamingCandidates,
  computeProtectedManifest,
} from "@pramaan/core";
import type { Audit, TraceEvent, ApprovalRequest, Finding, PatchProposal, PatchResult, VerifyResult, PolicyContext } from "@pramaan/core";

import { createDefaultLLMClient } from "./llm/factory.js";
import type { LLMClient } from "./llm/client.js";
import { TraceEmitter } from "./trace.js";
import { createBudget, type Budget } from "./budget.js";
import { createLocalApprovalCrypto, type ApprovalTokenInfo } from "./approvals.js";
import { runAgentLoop } from "./loop.js";
import { evidenceGenerateHandler } from "./tools/verifyTools.js";
import type { AgentToolContext } from "./tools/context.js";

export interface RunAuditOptions {
  projectRoot: string;
  configPath: string;
  auditId: string;
  maxToolCalls?: number;
  maxAttemptsPerFinding?: number;
  runtimeEnabled?: boolean;
  autoApprovePreview?: boolean;
  mode?: "live" | "replay";
  /** Override the LLM client (tests, replay mode, or a caller-supplied
   * client). Defaults to `createDefaultLLMClient()` from `./llm/factory.js`
   * when omitted — additive, optional field, so existing CLI/server call
   * sites that don't pass it keep working unchanged in "live" mode. */
  llmClient?: LLMClient;
  /** Where report bundles are written, relative to projectRoot.
   * Defaults to "pramaan-report". */
  reportOutDir?: string;
  maxWallClockMs?: number;
}

export interface RunAuditIO {
  emit(event: TraceEvent): void;
  requestApproval(request: ApprovalRequest): Promise<void>;
  onApprovalResolved(approvalId: string): Promise<ApprovalRequest>;
  /** Optional hooks for the real, server-minted HMAC approval token (Spec
   * 14.9 / I-06: "the agent never sees the token"). When the caller does
   * not supply these (e.g. the CLI, or tests), runAudit() falls back to an
   * equivalent local HMAC scheme generated internally — see KNOWN RISKS in
   * the A6b handoff report for why this gap exists and how to close it. */
  mintApprovalToken?(info: ApprovalTokenInfo): string;
  verifyApprovalToken?(token: string, info: ApprovalTokenInfo): boolean;
}

const ENGINE_VERSION = "0.1.0";
const TERMINAL = new Set(["verified", "static_verified", "failed", "ignored"]);
const REMAINING_COUNTS = new Set(["open", "remediating", "awaiting_approval", "failed"]);

function severityCounts(findings: Finding[]): { total: number; high: number; medium: number; low: number } {
  const counts = { total: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    counts.total += 1;
    if (f.severity === "high") counts.high += 1;
    else if (f.severity === "medium") counts.medium += 1;
    else counts.low += 1;
  }
  return counts;
}

/**
 * Main entry point shared by the CLI and the server. Spec Section 14.6.
 * scan -> agent loop -> verify -> evidence, per the exact pseudocode in
 * Section 14.4. The loop never reads a verdict from model text.
 */
export async function runAudit(options: RunAuditOptions, io: RunAuditIO): Promise<Audit> {
  // Spec I-08: PRAMAAN_RUNTIME=off is the only way G4 becomes `not_run`
  // instead of a hard fail. `runtimeEnabled` (already part of the existing
  // RunAuditOptions shape CLI/server call with) maps onto it 1:1.
  if (options.runtimeEnabled === false) {
    process.env.PRAMAAN_RUNTIME = "off";
  } else if (options.runtimeEnabled === true && process.env.PRAMAAN_RUNTIME === "off") {
    delete process.env.PRAMAAN_RUNTIME;
  }

  const startedAt = new Date().toISOString();
  const config = await loadConfig(options.configPath);
  const workspace = await createWorkspace(options.projectRoot, options.auditId);

  const model = await buildProjectModel(workspace.root, config);
  const { findings: scannedFindings, warnings: scannedWarnings } = runDetectorsWithWarnings({ model, config });
  const candidates = findConfirmShamingCandidates(model, config);
  const baselineManifest = computeProtectedManifest(model, config);

  const findings = new Map<string, Finding>();
  for (const f of scannedFindings) findings.set(f.findingId, f);

  const before = severityCounts(scannedFindings);

  const trace = new TraceEmitter((event) => io.emit(event));
  trace.emit({ type: "audit.started", actor: "engine", payload: { auditId: options.auditId, projectRoot: options.projectRoot, mode: options.mode ?? "live" } });
  trace.emit({
    type: "scan.completed",
    actor: "engine",
    payload: { findingCount: scannedFindings.length, confirmShamingCandidateCount: candidates.length, warnings: scannedWarnings },
  });

  const attemptsByFinding = new Map<string, number>();
  const budget: Budget = createBudget({
    maxToolCalls: options.maxToolCalls,
    maxAttempts: options.maxAttemptsPerFinding,
    maxWallClockMs: options.maxWallClockMs,
    attemptsByFinding,
  });

  const localCrypto = createLocalApprovalCrypto();
  const mintApprovalToken = io.mintApprovalToken ?? localCrypto.mint;
  const verifyApprovalToken = io.verifyApprovalToken ?? localCrypto.verify;

  // Placeholder `finding` on the shared PolicyContext — patchTools.ts swaps
  // it per-call via a shallow clone before every applyPatch() (P3/P10 need
  // the CURRENT finding, but attemptsByFinding/appliedProposalIds/etc. must
  // stay the SAME Map/Set instances across the whole audit).
  const placeholderFinding: Finding = scannedFindings[0] ?? {
    findingId: "F-NONE",
    ruleId: "PRM-001",
    pattern: "BASKET_SNEAKING",
    severity: "low",
    status: "open",
    detector: "AST",
    location: { file: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
    fingerprint: "",
    title: "",
    evidence: { sourceSnippet: "", fileSha256: "", observed: {}, warnings: [] },
    signals: [],
    score: null,
    requiresReview: false,
    regulation: [],
    attempts: 0,
  };

  const policyCtx: PolicyContext = {
    auditId: options.auditId,
    workspaceRoot: workspace.root,
    scannedFiles: new Set(workspace.files.keys()),
    protectedFingerprints: new Set(baselineManifest.map((e) => e.fingerprint)),
    appliedProposalIds: new Set<string>(),
    attemptsByFinding,
    maxAttempts: budget.maxAttempts,
    finding: placeholderFinding,
    approvalTokenVerifier: (token, info) => verifyApprovalToken(token, info),
  };

  const llmClient = options.llmClient ?? createDefaultLLMClient();
  const llmInfo = {
    provider:
      process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY
        ? "anthropic"
        : process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
          ? "gemini"
          : process.env.GROQ_API_KEY
            ? "groq"
            : "none",
    model: process.env.PRAMAAN_MODEL ?? "unknown",
    temperature: 0,
    mode: (options.mode ?? "live") as "live" | "replay",
  };

  const proposals = new Map<string, PatchProposal>();
  const results = new Map<string, PatchResult>();
  const verifies = new Map<string, VerifyResult>();
  const approvals = new Map<string, ApprovalRequest>();
  const approvalTokensByApprovalId = new Map<string, string>();
  const injectionNotes: string[] = [];

  const outDir = path.join(options.projectRoot, options.reportOutDir ?? "pramaan-report");

  function buildAudit(status: Audit["status"], completedAt?: string): Audit {
    const current = [...findings.values()];
    const after = severityCounts(current.filter((f) => REMAINING_COUNTS.has(f.status)));
    const audit: Audit = {
      auditId: options.auditId,
      projectName: path.basename(options.projectRoot),
      startedAt,
      engineVersion: ENGINE_VERSION,
      configHash: config.configHash,
      filesScanned: workspace.files.size,
      before,
      after,
      findings: current,
      status,
    };
    if (completedAt) audit.completedAt = completedAt;
    const evidence = ctx.evidenceResult;
    if (evidence) audit.evidenceHash = evidence.evidenceHash;
    return audit;
  }

  const ctx: AgentToolContext = {
    auditId: options.auditId,
    workspace,
    config,
    getProjectModel: () => buildProjectModel(workspace.root, config),
    findings,
    policyCtx,
    llmClient,
    baselineManifest,
    baselineFindings: scannedFindings,
    baselineWarnings: scannedWarnings,
    proposals,
    results,
    verifies,
    approvals,
    emit: (type, actor, payload) => trace.emit({ type, actor, payload }),
    getTraceHead: () => trace.traceHead,
    requestApproval: io.requestApproval,
    onApprovalResolved: io.onApprovalResolved,
    mintApprovalToken,
    verifyApprovalToken,
    approvalTokensByApprovalId,
    auditMeta: {
      projectName: path.basename(options.projectRoot),
      startedAt,
      engineVersion: ENGINE_VERSION,
      configHash: config.configHash,
      filesScanned: workspace.files.size,
    },
    outDir,
    llmInfo,
    injectionNotes,
    buildAudit,
  };

  // Spec 19 adversarial-failure list: zero findings at all -> agent never
  // started, audit completes immediately with an (empty) evidence pack.
  if (scannedFindings.length === 0 && candidates.length === 0) {
    await evidenceGenerateHandler({}, ctx);
    const audit = buildAudit("completed", new Date().toISOString());
    trace.emit({ type: "audit.completed", actor: "engine", payload: { status: audit.status, before: audit.before, after: audit.after } });
    return audit;
  }

  const outcome = await runAgentLoop(ctx, budget, trace);

  const anyFailed = [...findings.values()].some((f) => f.status === "failed");
  const status: Audit["status"] =
    outcome.stoppedReason === "wall_clock_exhausted" && ![...findings.values()].every((f) => TERMINAL.has(f.status))
      ? "completed_with_failures"
      : anyFailed
        ? "completed_with_failures"
        : "completed";

  const audit = buildAudit(status, new Date().toISOString());
  trace.emit({ type: "audit.completed", actor: "engine", payload: { status: audit.status, before: audit.before, after: audit.after, stoppedReason: outcome.stoppedReason } });

  return audit;
}
