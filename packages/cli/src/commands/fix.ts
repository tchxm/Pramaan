// `pramaan fix <findingId> --strategy <id> [--param k=v]` (manual, engine
// patch through the policy engine) or `--agent` (agent restricted to that
// finding). Spec Section 16.1.
import path from "node:path";
import { proposePatch, loadConfig, buildProjectModel, PramaanError } from "@pramaan/core";
import { findFinding } from "../localStore.js";
import { bold } from "../render/colors.js";

export interface FixFlags {
  strategy?: string;
  param?: string[];
  agent?: boolean;
  audit?: string;
}

function parseParams(pairs: string[] | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const p of pairs ?? []) {
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const key = p.slice(0, idx);
    const raw = p.slice(idx + 1);
    if (raw === "true" || raw === "false") out[key] = raw === "true";
    else if (!Number.isNaN(Number(raw)) && raw.trim() !== "") out[key] = Number(raw);
    else out[key] = raw;
  }
  return out;
}

export async function runFix(projectRoot: string, findingId: string, flags: FixFlags): Promise<number> {
  const found = await findFinding(projectRoot, findingId, flags.audit);
  if (!found) {
    console.error(`No finding ${findingId} found in local audit state under ${projectRoot}/.pramaan/audits`);
    return 2;
  }

  if (flags.agent) {
    // runAudit() has no single-finding restricted mode yet; report honestly
    // instead of fabricating a fix, per the "no fake fallbacks" invariant.
    console.error(
      "engine: `fix --agent` requires a single-finding mode in @pramaan/agent's runAudit() that is not implemented yet.",
    );
    return 3;
  }

  if (!flags.strategy) {
    console.error("usage: pramaan fix <findingId> --strategy <id> [--param k=v]");
    return 2;
  }

  try {
    const configPath = path.join(found.state.sourceRoot, "pramaan.config.json");
    const config = await loadConfig(configPath);
    const projectModel = await buildProjectModel(found.state.workspaceRoot, config);
    const proposal = proposePatch({
      finding: found.finding,
      strategy: flags.strategy,
      params: parseParams(flags.param),
      projectModel,
      config,
    });
    console.log(bold(`Proposal ${proposal.proposalId} (${proposal.risk})`));
    console.log(proposal.rationale);
    console.log(`Requires approval: ${proposal.requiresApproval}`);
    return 0;
  } catch (cause) {
    const message = cause instanceof PramaanError ? cause.message : String(cause);
    console.error(`engine: ${message}`);
    return 3;
  }
}
