// `pramaan verify [<findingId>]` — runs detector.verify for one or all
// patched findings. No LLM. Spec Section 16.1/16.3.
import path from "node:path";
import {
  verifyFinding,
  PramaanError,
  loadConfig,
  buildProjectModel,
  runDetectorsWithWarnings,
  computeProtectedManifest,
  type Workspace,
  type Finding,
} from "@pramaan/core";
import { findFinding, findLatestAuditId, loadState, type LocalAuditState } from "../localStore.js";
import { green, amber, red } from "../render/colors.js";

// NOTE (A5 courtesy fix, see handoff KNOWN RISKS): verifyFinding's
// signature changed from the Phase 1 stub's `(auditId, findingId)` to a
// single `VerifyFindingInput` bundle (workspace, config, and pre-patch
// baselines). This CLI does not yet persist those baselines anywhere in
// LocalAuditState, so this reconstructs them best-effort from
// `sourceRoot` — which patches never touch, only the workspace copy under
// `.pramaan/workspaces/<auditId>` does — by re-scanning it fresh on every
// `verify` call. That is correct for the common single-audit-session CLI
// flow but is O(re-scan) per call and doesn't account for a workspace that
// itself started from an already-patched sourceRoot. A6 (agent engineer)
// should replace this with baselines captured once at scan time and
// persisted in LocalAuditState.
async function buildVerifyContext(state: LocalAuditState) {
  const configPath = path.join(state.sourceRoot, "pramaan.config.json");
  const config = await loadConfig(configPath);
  const baselineModel = await buildProjectModel(state.sourceRoot, config);
  const baselineManifest = computeProtectedManifest(baselineModel, config);
  const { findings: baselineFindings, warnings: baselineWarnings } = runDetectorsWithWarnings({
    model: baselineModel,
    config,
  });
  const workspace: Workspace = {
    auditId: state.audit.auditId,
    root: state.workspaceRoot,
    sourceRoot: state.sourceRoot,
    files: new Map(),
  };
  return { config, baselineManifest, baselineFindings, baselineWarnings, workspace };
}

function verdictWord(verdict: string): string {
  if (verdict === "VERIFIED") return green(verdict);
  if (verdict === "STATIC_VERIFIED") return amber(verdict);
  return red(verdict);
}

export async function runVerify(
  projectRoot: string,
  findingId: string | undefined,
  opts: { audit?: string },
): Promise<number> {
  let auditId = opts.audit;
  let findingIds: string[];

  if (findingId) {
    const found = await findFinding(projectRoot, findingId, opts.audit);
    if (!found) {
      console.error(`No finding ${findingId} found under ${projectRoot}/.pramaan/audits`);
      return 2;
    }
    auditId = found.state.audit.auditId;
    findingIds = [findingId];
  } else {
    auditId = auditId ?? (await findLatestAuditId(projectRoot));
    if (!auditId) {
      console.error("No audits found. Run `pramaan scan` or `pramaan audit` first.");
      return 2;
    }
    const state = await loadState(projectRoot, auditId);
    findingIds = state?.audit.findings.map((f) => f.findingId) ?? [];
  }

  if (findingIds.length === 0) {
    console.log("engine: no findings to verify");
    return 0;
  }

  const state = await loadState(projectRoot, auditId!);
  if (!state) {
    console.error(`No local audit state found for ${auditId} under ${projectRoot}/.pramaan/audits`);
    return 2;
  }
  const findingsById = new Map<string, Finding>(state.audit.findings.map((f) => [f.findingId, f]));

  let allVerified = true;
  let anyEnvironmentError = false;
  for (const id of findingIds) {
    const finding = findingsById.get(id);
    if (!finding) {
      console.error(`engine: ${id} verification unavailable — finding not found in local audit state`);
      anyEnvironmentError = true;
      allVerified = false;
      continue;
    }
    try {
      const ctx = await buildVerifyContext(state);
      const result = await verifyFinding({
        auditId: auditId!,
        findingId: id,
        finding,
        workspace: ctx.workspace,
        config: ctx.config,
        baselineManifest: ctx.baselineManifest,
        baselineFindings: ctx.baselineFindings,
        baselineWarnings: ctx.baselineWarnings,
      });
      console.log(`engine: ${id} ${verdictWord(result.verdict)}`);
      if (result.verdict === "FAILED") allVerified = false;
    } catch (cause) {
      anyEnvironmentError = true;
      const message = cause instanceof PramaanError ? cause.message : String(cause);
      console.error(`engine: ${id} verification unavailable — ${message}`);
      allVerified = false;
    }
  }

  if (anyEnvironmentError) return 3;
  return allVerified ? 0 : 1;
}
