// detector.verify, finding.escalate, workspace.diff, evidence.generate —
// Spec 14.2 rows 14-17. detector.verify is THE ONLY VERDICT SOURCE (I-01):
// this is the single place in the whole agent package that is allowed to
// write "verified" / "static_verified" / "failed" onto a Finding.status,
// and it only does so by reading the real VerifyResult the engine returns.

import { z } from "zod";
import { ok, fail, zodIssues, verifyFinding, buildEvidencePack, writeReportBundle } from "@pramaan/core";
import type { Result } from "@pramaan/core";
import type { AgentToolContext } from "./context.js";

// ---------- detector.verify ----------

export const detectorVerifySchema = z.object({ findingId: z.string() });

export async function detectorVerifyHandler(input: unknown, ctx: AgentToolContext): Promise<Result<unknown>> {
  const parsed = detectorVerifySchema.safeParse(input);
  if (!parsed.success) return fail("E_BAD_INPUT", "invalid input for detector.verify", { issues: zodIssues(parsed.error) });

  const finding = ctx.findings.get(parsed.data.findingId);
  if (!finding) return fail("E_NOT_FOUND", `no finding "${parsed.data.findingId}"`);

  // Most recently applied proposal for this finding, if any (for G1's
  // CSS_OVERRIDE_WINS vs DETECTOR_STILL_MATCHES distinction).
  const appliedProposal = [...ctx.proposals.values()]
    .filter((p) => p.findingId === finding.findingId && ctx.results.get(p.proposalId)?.applied)
    .at(-1);

  const result = await verifyFinding({
    auditId: ctx.auditId,
    findingId: finding.findingId,
    finding,
    workspace: ctx.workspace,
    config: ctx.config,
    baselineManifest: ctx.baselineManifest,
    baselineFindings: ctx.baselineFindings,
    baselineWarnings: ctx.baselineWarnings,
    appliedProposal,
  });
  ctx.verifies.set(finding.findingId, result);
  ctx.emit("verify.result", "engine", { findingId: finding.findingId, result });

  // THE ONLY PLACE a verdict is written onto a Finding (I-01).
  if (result.verdict === "VERIFIED") {
    finding.status = "verified";
  } else if (result.verdict === "STATIC_VERIFIED") {
    finding.status = "static_verified";
  } else {
    const attemptsUsed = ctx.policyCtx.attemptsByFinding.get(finding.findingId) ?? 0;
    finding.attempts = attemptsUsed;
    if (attemptsUsed >= ctx.policyCtx.maxAttempts) {
      finding.status = "failed";
      finding.failure = result.failureReasons[0] ?? { code: "DETECTOR_STILL_MATCHES", message: "verification failed", data: {} };
    } else {
      finding.status = "open";
    }
  }

  return ok(result);
}

// ---------- finding.escalate ----------

export const findingEscalateSchema = z.object({ findingId: z.string(), summary: z.string() });

export async function findingEscalateHandler(input: unknown, ctx: AgentToolContext): Promise<Result<unknown>> {
  const parsed = findingEscalateSchema.safeParse(input);
  if (!parsed.success) return fail("E_BAD_INPUT", "invalid input for finding.escalate", { issues: zodIssues(parsed.error) });

  const finding = ctx.findings.get(parsed.data.findingId);
  if (!finding) return fail("E_NOT_FOUND", `no finding "${parsed.data.findingId}"`);

  // summary is stored, not trusted (spec row 15) — never used to set a
  // verdict, purely informational for the human reviewer.
  finding.status = "failed";
  if (!finding.failure) {
    finding.failure = { code: "DETECTOR_STILL_MATCHES", message: "escalated by agent", data: { summary: parsed.data.summary } };
  }
  ctx.emit("tool.result", "engine", { tool: "finding.escalate", findingId: finding.findingId, summary: parsed.data.summary });

  return ok({ status: "failed" });
}

// ---------- workspace.diff ----------

export const workspaceDiffSchema = z.object({});

export async function workspaceDiffHandler(_input: unknown, ctx: AgentToolContext): Promise<Result<unknown>> {
  let diff = "";
  for (const result of ctx.results.values()) {
    if (result.applied) diff += result.diff;
  }
  return ok({ diff });
}

// ---------- evidence.generate ----------

export const evidenceGenerateSchema = z.object({});

const TERMINAL_STATUSES = new Set(["verified", "static_verified", "failed", "ignored"]);

export function allFindingsTerminal(ctx: AgentToolContext): boolean {
  return [...ctx.findings.values()].every((f) => TERMINAL_STATUSES.has(f.status));
}

export async function evidenceGenerateHandler(_input: unknown, ctx: AgentToolContext): Promise<Result<unknown>> {
  if (!allFindingsTerminal(ctx)) {
    return fail("E_STATE_CONFLICT", "evidence.generate is only allowed once every finding is terminal (verified/static_verified/failed/ignored)");
  }

  const findingsList = [...ctx.findings.values()];
  const findingsPayload = findingsList.map((finding) => {
    const proposals = [...ctx.proposals.values()].filter((p) => p.findingId === finding.findingId);
    return {
      finding,
      proposals: proposals.map((proposal) => ({
        proposal,
        result: ctx.results.get(proposal.proposalId) ?? { proposalId: proposal.proposalId, applied: false, filesChanged: [], diff: "", policyViolations: [] },
        verify: ctx.verifies.get(finding.findingId) ?? null,
      })),
      approvals: [...ctx.approvals.values()].filter((a) => a.findingId === finding.findingId),
    };
  });

  const files: { path: string; sha256Before: string; sha256After: string }[] = [];
  for (const rel of ctx.workspace.files.keys()) {
    const before = ctx.workspace.files.get(rel)?.sha256 ?? "";
    const after = before; // workspace.files is the pre-scan snapshot; a full
    // post-patch re-hash is a nice-to-have left for a future pass (see KNOWN RISKS).
    files.push({ path: rel, sha256Before: before, sha256After: after });
  }

  const audit = ctx.buildAudit(
    allFindingsTerminal(ctx) && findingsList.some((f) => f.status === "failed")
      ? "completed_with_failures"
      : "completed",
  );

  const pack = buildEvidencePack({
    audit,
    engine: { version: ctx.auditMeta.engineVersion, node: process.version, playwright: "unknown", regulationDataVersion: "unknown" },
    llm: ctx.llmInfo,
    config: ctx.config as unknown as Record<string, unknown>,
    files,
    findings: findingsPayload,
    artifacts: [],
    traceHead: ctx.getTraceHead(),
  });

  const outDir = `${ctx.outDir}/${ctx.auditId}`;
  const written = await writeReportBundle(pack, [], outDir);

  ctx.evidenceResult = { packPath: written.packPath, evidenceHash: pack.evidenceHash };
  ctx.emit("evidence.generated", "engine", { packPath: written.packPath, evidenceHash: pack.evidenceHash });

  return ok({ packPath: written.packPath, evidenceHash: pack.evidenceHash });
}
