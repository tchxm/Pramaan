// Patch application engine — Spec Section 12.1/12.2/12.6.
// proposePatch: strategy + params -> concrete PatchProposal (I-02: agent
// proposes, engine disposes — every op is derived from the live
// ProjectModel, never trusted blindly from the caller).
// applyPatch: transactional apply — policy check -> snapshot -> write ->
// parse-check -> commit, or full rollback (I-03/I-05, spec 12.6).

import { randomUUID } from "node:crypto";
import { writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { Finding, PatchProposal, PatchResult } from "../types.js";
import type { ProjectModel } from "../parser/model.js";
import type { PramaanConfig } from "../config.js";
import type { Workspace } from "../workspace.js";
import { snapshotFiles, restoreSnapshot, diffFiles, pathExists } from "../workspace.js";
import { parseJsxFile } from "../parser/jsx.js";
import { parseCssFile } from "../parser/css.js";
import { PramaanError, err } from "../errors.js";
import { buildProposalOps } from "./strategies.js";
import { applyOp, FEE_DISCLOSURE_PATH, type ApplyOpContext } from "./ops.js";
import { checkPolicy, type PolicyContext } from "./policy.js";

export interface ProposeInput {
  finding: Finding;
  strategy: string;
  params: Record<string, string | number | boolean>;
  projectModel: ProjectModel;
  config: PramaanConfig;
}

/**
 * Builds a concrete PatchProposal (ops) from a strategy id + params.
 * Spec Section 12.1 (strategies.ts) and 12.2 (ops.ts). Every op is derived
 * from `input.projectModel` (the live, parsed source) — the caller's
 * strategy/params select *which* remediation, never the literal text
 * touched.
 */
export function proposePatch(input: ProposeInput): PatchProposal {
  const { ops, risk } = buildProposalOps(input);
  return {
    proposalId: `pp-${randomUUID()}`,
    findingId: input.finding.findingId,
    strategy: input.strategy,
    rationale: `Engine-generated proposal for strategy "${input.strategy}" against finding ${input.finding.findingId} (${ops.length} op${ops.length === 1 ? "" : "s"}).`,
    ops,
    risk,
    requiresApproval: risk === "semantic",
  };
}

function toParseTargetPath(relPath: string): "css" | "js" | null {
  if (relPath.endsWith(".css")) return "css";
  if (/\.(tsx|ts|jsx|js)$/.test(relPath)) return "js";
  return null;
}

function violationsFromError(cause: unknown, opId: string): PatchResult["policyViolations"] {
  if (cause instanceof PramaanError) {
    return [{ code: cause.code, opId, message: cause.message }];
  }
  return [{ code: "E_PATCH_PARSE_ERROR", opId, message: cause instanceof Error ? cause.message : String(cause) }];
}

/**
 * Transactional patch application: snapshot -> write -> parse-check ->
 * commit or full rollback. Spec Section 12.6. Snapshots are scoped under
 * `.pramaan/workspaces/<auditId>/.snapshots/<proposalId>/` by convention —
 * this implementation reuses workspace.ts's in-memory Snapshot (content
 * captured before any write, restored verbatim on failure) rather than
 * materializing that directory on disk; see KNOWN RISKS.
 */
export async function applyPatch(
  workspace: Workspace,
  proposal: PatchProposal,
  config: PramaanConfig,
  policyCtx: PolicyContext,
): Promise<PatchResult> {
  const violations = checkPolicy(proposal, policyCtx);
  if (violations.length > 0) {
    return { proposalId: proposal.proposalId, applied: false, filesChanged: [], diff: "", policyViolations: violations };
  }

  const affectedFiles = Array.from(new Set(proposal.ops.map((op) => op.file)));
  const existing: string[] = [];
  for (const f of affectedFiles) {
    if (await pathExists(path.join(workspace.root, f))) existing.push(f);
  }
  if (!existing.includes(FEE_DISCLOSURE_PATH) && (await pathExists(path.join(workspace.root, FEE_DISCLOSURE_PATH)))) {
    existing.push(FEE_DISCLOSURE_PATH);
  }

  const snapshot = await snapshotFiles(workspace, existing);
  const beforeContents = new Map(snapshot.files);

  const ctxFiles = new Map<string, string>();
  for (const f of existing) {
    ctxFiles.set(f, beforeContents.get(f) as string);
  }
  const createdFiles = new Set<string>();
  const opCtx: ApplyOpContext = { files: ctxFiles, createdFiles, config, finding: policyCtx.finding };

  let lastOpId = "";
  try {
    for (const op of proposal.ops) {
      lastOpId = op.opId;
      if (!ctxFiles.has(op.file)) {
        throw err("E_TARGET_NOT_FOUND", `file ${op.file} not found in workspace`, { file: op.file });
      }
      applyOp(op, opCtx);
    }

    const filesChanged: string[] = [];
    for (const [relPath, newContent] of ctxFiles) {
      const oldContent = beforeContents.get(relPath);
      if (oldContent === newContent && !createdFiles.has(relPath)) continue;
      const abs = path.join(workspace.root, relPath);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, newContent, "utf-8");
      filesChanged.push(relPath);
    }

    // P8: every changed TS/TSX/CSS file parses, or the whole proposal rolls back.
    for (const relPath of filesChanged) {
      const kind = toParseTargetPath(relPath);
      const content = ctxFiles.get(relPath) as string;
      if (kind === "css") {
        const { parseError } = parseCssFile(relPath, content);
        if (parseError) throw err("E_PATCH_PARSE_ERROR", parseError.message, { file: relPath });
      } else if (kind === "js") {
        const { parseError } = parseJsxFile(relPath, content);
        if (parseError) throw err("E_PATCH_PARSE_ERROR", parseError.message, { file: relPath });
      }
    }

    let diff = "";
    for (const relPath of filesChanged) {
      const before = beforeContents.get(relPath) ?? "";
      diff += await diffFiles(workspace, relPath, before);
    }

    policyCtx.appliedProposalIds.add(proposal.proposalId);
    policyCtx.attemptsByFinding.set(proposal.findingId, (policyCtx.attemptsByFinding.get(proposal.findingId) ?? 0) + 1);

    return { proposalId: proposal.proposalId, applied: true, filesChanged, diff, policyViolations: [] };
  } catch (cause) {
    // Full rollback: workspace must be byte-identical to before (F08d).
    await restoreSnapshot(workspace, snapshot);
    for (const relPath of createdFiles) {
      await rm(path.join(workspace.root, relPath), { force: true });
    }
    policyCtx.attemptsByFinding.set(proposal.findingId, (policyCtx.attemptsByFinding.get(proposal.findingId) ?? 0) + 1);
    return {
      proposalId: proposal.proposalId,
      applied: false,
      filesChanged: [],
      diff: "",
      policyViolations: violationsFromError(cause, lastOpId),
    };
  }
}
