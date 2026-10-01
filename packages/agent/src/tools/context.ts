// AgentToolContext — the backbone every tool handler receives. Bundles the
// workspace, live project model (re-parsed on demand so tools always see
// post-patch state), per-audit mutable state, the engine's PolicyContext,
// the LLM client (for semantic.inspect's sub-call), and the trace/approval
// hooks the loop wires in. Spec Section 14.2/14.9.

import type {
  Audit,
  ApprovalRequest,
  Finding,
  PatchProposal,
  PatchResult,
  PramaanConfig,
  ProjectModel,
  TraceEvent,
  TraceType,
  VerifyResult,
  Workspace,
} from "@pramaan/core";
import type { PolicyContext, ProtectedElementEntry, DetectorWarning } from "@pramaan/core";
import type { LLMClient } from "../llm/client.js";
import type { ApprovalTokenInfo } from "../approvals.js";

export type { ApprovalTokenInfo };

export interface AgentToolContext {
  auditId: string;
  workspace: Workspace;
  config: PramaanConfig;

  /** Always re-parses the CURRENT on-disk workspace state. Tools that need
   * a fresh ProjectModel (ast.inspect, css.cascade, price_flow.inspect,
   * detector.scan, patch.propose) call this rather than caching a stale
   * model across patch.apply calls. */
  getProjectModel: () => Promise<ProjectModel>;

  /** Mutable, keyed by findingId. The loop seeds this at scan time; tools
   * mutate finding.status/attempts/failure in place as the audit proceeds. */
  findings: Map<string, Finding>;

  policyCtx: PolicyContext;
  llmClient: LLMClient;

  /** Pre-patch baselines, computed once (Spec 14.4 "scan -> findings"). */
  baselineManifest: ProtectedElementEntry[];
  baselineFindings: Finding[];
  baselineWarnings: DetectorWarning[];

  proposals: Map<string, PatchProposal>;
  results: Map<string, PatchResult>;
  /** Latest VerifyResult per findingId. */
  verifies: Map<string, VerifyResult>;
  approvals: Map<string, ApprovalRequest>;

  emit: (type: TraceType, actor: TraceEvent["actor"], payload: Record<string, unknown>) => TraceEvent;
  getTraceHead: () => string;
  getTraceEvents?: () => TraceEvent[];
  requestApproval: (request: ApprovalRequest) => Promise<void>;
  onApprovalResolved: (approvalId: string) => Promise<ApprovalRequest>;

  mintApprovalToken: (info: ApprovalTokenInfo) => string;
  verifyApprovalToken: (token: string, info: ApprovalTokenInfo) => boolean;
  /** approvalId -> token minted when the approval resolved approved/edited,
   * so patch.apply can look it up by approvalId per spec 14.9 step 3
   * ("patch.apply looks it up by approvalId"). */
  approvalTokensByApprovalId: Map<string, string>;

  /** Metadata needed by evidence.generate / writeReportBundle. */
  auditMeta: {
    projectName: string;
    startedAt: string;
    engineVersion: string;
    configHash: string;
    filesScanned: number;
  };
  outDir: string;
  llmInfo: { provider: string; model: string; temperature: number; mode: "live" | "replay" };

  /** INJECTION_SUSPECTED observations collected by source.read/source.search
   * (Spec 14.8). Informational only; never affects verdicts. */
  injectionNotes: string[];

  /** Set true once evidence.generate has successfully run, so the loop and
   * runAudit() know not to run it again / can read the result. */
  evidenceResult?: { packPath: string; evidenceHash: string };

  /** Current Audit snapshot builder — returns an Audit object reflecting
   * `findings` as of right now. Used by evidence.generate and by the loop
   * to populate the final returned Audit. */
  buildAudit: (status: Audit["status"], completedAt?: string) => Audit;
}

export function nowIso(): string {
  return new Date().toISOString();
}
