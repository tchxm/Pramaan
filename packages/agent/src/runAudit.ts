import type { Audit, TraceEvent, ApprovalRequest } from "@pramaan/core";

export interface RunAuditOptions {
  projectRoot: string;
  configPath: string;
  auditId: string;
  maxToolCalls?: number;
  maxAttemptsPerFinding?: number;
  runtimeEnabled?: boolean;
  autoApprovePreview?: boolean;
  mode?: "live" | "replay";
}

export interface RunAuditIO {
  emit(event: TraceEvent): void;
  requestApproval(request: ApprovalRequest): Promise<void>;
  onApprovalResolved(approvalId: string): Promise<ApprovalRequest>;
}

/**
 * Main entry point shared by the CLI and the server. Spec Section 14.6.
 * scan -> agent loop -> verify -> evidence, per the exact pseudocode in
 * Section 14.4. The loop never reads a verdict from model text.
 */
export async function runAudit(_options: RunAuditOptions, _io: RunAuditIO): Promise<Audit> {
  // TODO(A6, Phase 7): implement the agent loop against @pramaan/core.
  throw new Error("runAudit not implemented yet");
}
