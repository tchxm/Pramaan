// patch.propose, approval.request, patch.apply, project.build — Spec 14.2
// rows 10-13, 14.9 (approval handshake). I-02: the agent only ever chooses
// a strategy/params; proposePatch/applyPatch (engine) build and validate
// the actual edit.

import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ok, fail, proposePatch, applyPatch } from "@pramaan/core";
import type { Result, ApprovalRequest, PatchOp } from "@pramaan/core";
import type { AgentToolContext } from "./context.js";
import { sha256OfText } from "../approvals.js";

const exec = promisify(execCb);

// ---------- patch.propose ----------

export const patchProposeSchema = z.object({
  findingId: z.string(),
  strategy: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export async function patchProposeHandler(input: unknown, ctx: AgentToolContext): Promise<Result<unknown>> {
  const parsed = patchProposeSchema.safeParse(input);
  if (!parsed.success) return fail("E_BAD_INPUT", "invalid input for patch.propose", { issues: parsed.error.issues });

  const finding = ctx.findings.get(parsed.data.findingId);
  if (!finding) return fail("E_NOT_FOUND", `no finding "${parsed.data.findingId}"`);

  const model = await ctx.getProjectModel();
  try {
    const proposal = proposePatch({
      finding,
      strategy: parsed.data.strategy,
      params: parsed.data.params ?? {},
      projectModel: model,
      config: ctx.config,
    });
    ctx.proposals.set(proposal.proposalId, proposal);
    return ok(proposal);
  } catch (cause) {
    const code = (cause as { code?: string })?.code ?? "E_INTERNAL";
    const message = cause instanceof Error ? cause.message : String(cause);
    return fail(code as never, message);
  }
}

// ---------- approval.request ----------

export const approvalRequestSchema = z.object({ findingId: z.string(), proposalId: z.string() });

export async function approvalRequestHandler(input: unknown, ctx: AgentToolContext): Promise<Result<unknown>> {
  const parsed = approvalRequestSchema.safeParse(input);
  if (!parsed.success) return fail("E_BAD_INPUT", "invalid input for approval.request", { issues: parsed.error.issues });

  const finding = ctx.findings.get(parsed.data.findingId);
  if (!finding) return fail("E_NOT_FOUND", `no finding "${parsed.data.findingId}"`);
  const proposal = ctx.proposals.get(parsed.data.proposalId);
  if (!proposal) return fail("E_NOT_FOUND", `no proposal "${parsed.data.proposalId}"`);

  const replaceOp = proposal.ops.find((op) => op.kind === "REPLACE_JSX_TEXT") as (PatchOp & { kind: "REPLACE_JSX_TEXT" }) | undefined;
  const original = typeof replaceOp?.params.from === "string" ? replaceOp.params.from : finding.title;
  const proposed = typeof replaceOp?.params.to === "string" ? replaceOp.params.to : "";

  const approvalId = `ap-${randomUUID()}`;
  const request: ApprovalRequest = {
    approvalId,
    findingId: parsed.data.findingId,
    proposalId: parsed.data.proposalId,
    kind: proposal.risk === "semantic" ? "semantic_text" : "deterministic_preview",
    original,
    proposed,
    reason: `Approval requested for strategy "${proposal.strategy}" on finding ${parsed.data.findingId}.`,
    status: "pending",
  };
  ctx.approvals.set(approvalId, request);
  finding.status = "awaiting_approval";

  ctx.emit("approval.requested", "engine", { approval: request });
  // Suspends the loop (Spec 14.9 step 1) until the caller resolves it.
  await ctx.requestApproval(request);
  const resolved = await ctx.onApprovalResolved(approvalId);
  ctx.approvals.set(approvalId, resolved);
  ctx.emit("approval.resolved", "human", { approvalId, approval: resolved });

  if (resolved.status === "approved" || resolved.status === "edited") {
    const toText = resolved.status === "edited" && resolved.editedText !== undefined ? resolved.editedText : resolved.proposed;
    const token = ctx.mintApprovalToken({
      auditId: ctx.auditId,
      findingId: resolved.findingId,
      proposalId: resolved.proposalId,
      textSha256: sha256OfText(toText),
    });
    ctx.approvalTokensByApprovalId.set(approvalId, token);
  } else {
    // rejected: finding returns to open per spec 14.9 step 4.
    finding.status = "open";
  }

  return ok({ approvalId, status: resolved.status });
}

// ---------- patch.apply ----------

export const patchApplySchema = z.object({ proposalId: z.string(), approvalId: z.string().optional() });

export async function patchApplyHandler(input: unknown, ctx: AgentToolContext): Promise<Result<unknown>> {
  const parsed = patchApplySchema.safeParse(input);
  if (!parsed.success) return fail("E_BAD_INPUT", "invalid input for patch.apply", { issues: parsed.error.issues });

  const proposal = ctx.proposals.get(parsed.data.proposalId);
  if (!proposal) return fail("E_NOT_FOUND", `no proposal "${parsed.data.proposalId}"`);

  const finding = ctx.findings.get(proposal.findingId);
  if (!finding) return fail("E_NOT_FOUND", `no finding "${proposal.findingId}" for proposal`);

  // Attach the human-approved token to any REPLACE_JSX_TEXT op (I-06: the
  // agent never mints this itself; it only forwards the approvalId it was
  // given and we look the already-minted token up by that id).
  let ops = proposal.ops;
  if (parsed.data.approvalId) {
    const token = ctx.approvalTokensByApprovalId.get(parsed.data.approvalId);
    if (token) {
      ops = proposal.ops.map((op) =>
        op.kind === "REPLACE_JSX_TEXT" ? { ...op, params: { ...op.params, approvalToken: token } } : op,
      );
    }
  }
  const effectiveProposal = { ...proposal, ops };

  finding.status = "remediating";
  const policyCtx = { ...ctx.policyCtx, finding };
  const result = await applyPatch(ctx.workspace, effectiveProposal, ctx.config, policyCtx);
  ctx.results.set(proposal.proposalId, result);

  ctx.emit("patch.applied", "engine", { proposalId: proposal.proposalId, findingId: proposal.findingId, result });

  if (!result.applied) {
    // Attempt already counted by applyPatch's own bookkeeping on ctx.policyCtx
    // (we pass a shallow-cloned ctx above only to swap `finding`; the
    // underlying attemptsByFinding/appliedProposalIds maps are the SAME
    // instances, so this is reflected on ctx.policyCtx too).
    finding.status = "open";
  }

  return ok(result);
}

// ---------- project.build ----------

export const projectBuildSchema = z.object({});

function tailLines(text: string, n: number): string {
  const lines = text.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - n)).join("\n");
}

export async function projectBuildHandler(_input: unknown, ctx: AgentToolContext): Promise<Result<unknown>> {
  const buildCommand = ctx.config.runtime.buildCommand || "npm run build";
  try {
    const { stdout, stderr } = await exec(buildCommand, { cwd: ctx.workspace.root, timeout: 120_000, windowsHide: true });
    return ok({ ok: true, logTail: tailLines(`${stdout}\n${stderr}`, 40) });
  } catch (cause) {
    const out = (cause as { stdout?: string }).stdout ?? "";
    const errOut = (cause as { stderr?: string }).stderr ?? "";
    return ok({ ok: false, logTail: tailLines(`${out}\n${errOut}`, 40) });
  }
}
