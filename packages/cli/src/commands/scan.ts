// `pramaan scan <path>` — no LLM. Creates a workspace and prints findings.
// Spec Section 16.1 / 16.4.
import path from "node:path";
import {
  loadConfig,
  buildProjectModel,
  runDetectors,
  createWorkspace,
  PramaanError,
} from "@pramaan/core";
import type { Audit } from "@pramaan/core";
import { nextAuditId } from "../counter.js";
import { pramaanDir, saveState } from "../localStore.js";
import { renderFindingsList, renderFooter } from "../render/findings.js";

export async function runScan(projectPath: string, opts: { config?: string; json?: boolean }): Promise<number> {
  const projectRoot = path.resolve(process.cwd(), projectPath);
  const configPath = opts.config ? path.resolve(process.cwd(), opts.config) : path.join(projectRoot, "pramaan.config.json");

  let config;
  try {
    config = await loadConfig(configPath);
  } catch (cause) {
    console.error(cause instanceof PramaanError ? cause.message : String(cause));
    return 2;
  }

  const auditId = await nextAuditId(pramaanDir(projectRoot));
  const workspace = await createWorkspace(projectRoot, auditId);

  if (!opts.json) {
    console.log("PRAMAAN 0.1.0");
    console.log(`Scanning ${workspace.files.size} files...`);
  }

  const model = await buildProjectModel(workspace.root, config);
  const findings = runDetectors({ model, config });

  const audit: Audit = {
    auditId,
    projectName: path.basename(projectRoot),
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    engineVersion: "0.1.0",
    configHash: config.configHash,
    filesScanned: workspace.files.size,
    before: {
      total: findings.length,
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      low: findings.filter((f) => f.severity === "low").length,
    },
    findings,
    status: "completed",
  };
  await saveState(projectRoot, {
    audit,
    sourceRoot: projectRoot,
    workspaceRoot: workspace.root,
    applied: false,
    approvals: [],
    proposals: [],
    results: [],
    verifies: [],
  });

  if (opts.json) {
    console.log(JSON.stringify(audit, null, 2));
  } else {
    if (model.warnings.length > 0) {
      console.log(`  parsed ${model.files.length} · skipped 0 · warnings ${model.warnings.length}`);
    }
    console.log("");
    console.log(renderFindingsList(findings));
    console.log(renderFooter(auditId, workspace.root));
  }

  return findings.length > 0 ? 1 : 0;
}
