// `pramaan audit <path>` — full run: scan -> agent remediation -> verify ->
// evidence, via the shared runAudit() black box. Spec Section 16.1/16.2/16.3.
import path from "node:path";
import { PramaanError, type Audit, type ApprovalRequest } from "@pramaan/core";
import { runAudit, type RunAuditIO } from "@pramaan/agent";
import { nextAuditId } from "../counter.js";
import { pramaanDir, saveState, appendTrace } from "../localStore.js";
import { renderTraceLine } from "../render/trace.js";
import { renderFooter } from "../render/findings.js";

export interface AuditFlags {
  config?: string;
  out?: string;
  json?: boolean;
  noRuntime?: boolean;
  autoApprovePreview?: boolean;
  maxAttempts?: number;
  model?: string;
  yes?: boolean;
}

function exitCodeFor(audit: Audit): number {
  if (audit.status === "error") return 3;
  if (audit.findings.length === 0) return 0;
  const allVerified = audit.findings.every(
    (f) => f.status === "verified" || f.status === "static_verified" || f.status === "ignored",
  );
  return allVerified ? 0 : 1;
}

export async function runAuditCommand(projectPath: string, flags: AuditFlags): Promise<number> {
  const projectRoot = path.resolve(process.cwd(), projectPath);
  const configPath = flags.config
    ? path.resolve(process.cwd(), flags.config)
    : path.join(projectRoot, "pramaan.config.json");
  const maxAttempts = Math.min(Math.max(flags.maxAttempts ?? 3, 1), 5);

  const auditId = await nextAuditId(pramaanDir(projectRoot));

  if (!flags.json) console.log("PRAMAAN 0.1.0");

  const pendingApprovals = new Map<string, (req: ApprovalRequest) => void>();

  const io: RunAuditIO = {
    emit: (event) => {
      void appendTrace(projectRoot, auditId, { type: event.type, actor: event.actor, payload: event.payload });
      if (!flags.json) {
        const line = renderTraceLine({ ...event, seq: 0, ts: "", prevHash: "", hash: "" });
        if (line) console.log(line);
      }
    },
    requestApproval: async (request) => {
      await appendTrace(projectRoot, auditId, {
        type: "approval.requested",
        actor: "engine",
        payload: { approval: request },
      });
      if (!flags.json) {
        console.log(`human: approval requested for ${request.findingId} — ${request.reason}`);
      }
      if (flags.autoApprovePreview && request.kind === "deterministic_preview") {
        const resolver = pendingApprovals.get(request.approvalId);
        resolver?.({ ...request, status: "approved", resolvedAt: new Date().toISOString() });
      }
    },
    onApprovalResolved: (approvalId) =>
      new Promise<ApprovalRequest>((resolve) => {
        pendingApprovals.set(approvalId, resolve);
      }),
  };

  let audit: Audit;
  try {
    audit = await runAudit(
      {
        projectRoot,
        configPath,
        auditId,
        maxAttemptsPerFinding: maxAttempts,
        runtimeEnabled: !flags.noRuntime,
        autoApprovePreview: flags.autoApprovePreview,
        mode: "live",
      },
      io,
    );
  } catch (cause) {
    const message = cause instanceof PramaanError ? cause.message : cause instanceof Error ? cause.message : String(cause);
    audit = {
      auditId,
      projectName: path.basename(projectRoot),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      engineVersion: "0.1.0",
      configHash: "",
      filesScanned: 0,
      before: { total: 0, high: 0, medium: 0, low: 0 },
      findings: [],
      status: "error",
    };
    if (flags.json) {
      console.log(JSON.stringify({ error: { code: cause instanceof PramaanError ? cause.code : "E_INTERNAL", message } }, null, 2));
    } else {
      console.error(`engine: audit failed — ${message}`);
    }
  }

  await saveState(projectRoot, {
    audit,
    sourceRoot: projectRoot,
    workspaceRoot: path.join(projectRoot, ".pramaan", "workspaces", auditId),
    applied: false,
    approvals: [],
    proposals: [],
    results: [],
    verifies: [],
  });

  if (flags.json && audit.status !== "error") {
    console.log(JSON.stringify(audit, null, 2));
  } else if (!flags.json) {
    console.log(renderFooter(auditId, path.join(projectRoot, ".pramaan", "workspaces", auditId)));
  }

  return exitCodeFor(audit);
}
