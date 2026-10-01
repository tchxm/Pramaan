// Authoritative data contracts. Source of truth: PRAMAAN_MASTER_SPEC.md Section 8.
// This module is imported by every other package. It must never import from
// packages/agent (I-01/I-02 boundary — core never imports agent).

// ---------- identifiers ----------
export type PatternId =
  | "BASKET_SNEAKING"
  | "FALSE_URGENCY"
  | "INTERFACE_INTERFERENCE"
  | "DRIP_PRICING"
  | "CONFIRM_SHAMING";

export type RuleId = "PRM-001" | "PRM-002" | "PRM-003" | "PRM-004" | "PRM-005";

export type Severity = "high" | "medium" | "low";

export type DetectorKind = "AST" | "CSS_CASCADE" | "PRICE_FLOW" | "SEMANTIC_CANDIDATE";

// ---------- location & evidence ----------
export interface SourceLocation {
  file: string; // path relative to workspace root, POSIX separators
  startLine: number;
  startColumn: number; // 1-based line, 0-based column
  endLine: number;
  endColumn: number;
}

export interface Signal {
  id: string; // e.g. "S1_CONTRAST_GAP"
  fired: boolean;
  weight: number; // 0..1 as defined by the rule
  observed: Record<string, string | number | boolean | null>;
}

export interface CascadeEntry {
  property: string;
  value: string;
  important: boolean;
  file: string;
  selector: string;
  line: number;
  specificity: [number, number, number];
  origin: "stylesheet" | "inline";
  winner: boolean;
}

export interface Evidence {
  sourceSnippet: string; // <= 12 lines around the finding
  fileSha256: string; // hash of the whole file at detection time
  observed: Record<string, string | number | boolean | null>;
  cascade?: CascadeEntry[]; // for CSS_CASCADE findings
  warnings: string[]; // e.g. "ANCESTOR_CONTEXT_UNKNOWN"
}

// ---------- findings ----------
export type FindingStatus =
  | "open"
  | "remediating"
  | "awaiting_approval"
  | "verified"
  | "static_verified"
  | "failed"
  | "ignored";

export interface RegulationRef {
  jurisdiction: "IN";
  framework: string;
  patternName: string;
  auditDuty: string; // source-attributed self-audit advisory context
  plainBasis: string; // paraphrase from india.json
  verifiedAgainstGazette: boolean;
}

export interface Finding {
  findingId: string; // "F-PRM-001-1" (rule + 1-based index in scan order)
  ruleId: RuleId;
  pattern: PatternId;
  severity: Severity;
  status: FindingStatus;
  detector: DetectorKind;
  location: SourceLocation;
  fingerprint: string; // sha256 hex; see 8.1
  title: string; // one sentence
  evidence: Evidence;
  signals: Signal[];
  score: number | null; // deterministic, 0..1, or null if not applicable
  requiresReview: boolean; // true for II (potential) and CS
  regulation: RegulationRef[];
  attempts: number; // remediation attempts consumed
  failure?: FailureReason; // set by the engine when status becomes "failed"
}

// ---------- patching ----------
export type PatchOpKind =
  | "SET_INITIAL_STATE_LITERAL"
  | "WIRE_CONTROLLED_CHECKBOX"
  | "SET_CSS_DECLARATION"
  | "REMOVE_CSS_IMPORTANT"
  | "REMOVE_JSX_ELEMENT" // only for PRM-002 timer element (12.3)
  | "INSERT_FEE_DISCLOSURE"
  | "REPLACE_JSX_TEXT"; // semantic; requires approval token

export interface PatchOp {
  opId: string;
  kind: PatchOpKind;
  file: string;
  target: { fingerprint?: string; selector?: string; line?: number };
  params: Record<string, string | number | boolean>;
}

export interface PatchProposal {
  proposalId: string;
  findingId: string;
  strategy: string; // one of the strategy ids in 12.1
  rationale: string; // engine-generated text, not LLM text
  ops: PatchOp[];
  risk: "deterministic" | "semantic";
  requiresApproval: boolean;
}

export interface PolicyViolation {
  code: ErrorCode;
  opId: string;
  message: string;
}

export interface PatchResult {
  proposalId: string;
  applied: boolean;
  filesChanged: string[];
  diff: string; // unified diff of this proposal
  policyViolations: PolicyViolation[];
}

// ---------- verification ----------
export type GateId =
  | "G1_DETECTOR_CLEAR"
  | "G2_PRESERVATION"
  | "G3_BUILD"
  | "G4_RUNTIME"
  | "G5_NO_REGRESSION";

export interface GateResult {
  gate: GateId;
  status: "pass" | "fail" | "not_run"; // not_run only when runtime is disabled (I-08)
  details: Record<string, unknown>;
}

export type FailureCode =
  | "DETECTOR_STILL_MATCHES"
  | "CSS_OVERRIDE_WINS"
  | "PRESERVATION_BROKEN"
  | "BUILD_FAILED"
  | "RUNTIME_MISMATCH"
  | "REGRESSION_INTRODUCED"
  | "RUNTIME_NOT_RUN"
  | "BUDGET_EXHAUSTED";

export interface FailureReason {
  code: FailureCode;
  message: string;
  data: Record<string, unknown>; // e.g. winning CSS rule {file, selector, line, important}
}

export interface VerifyResult {
  findingId: string;
  fingerprint: string;
  verdict: "VERIFIED" | "STATIC_VERIFIED" | "FAILED";
  gates: GateResult[];
  failureReasons: FailureReason[];
  engineVersion: string;
  verifiedAt: string; // ISO 8601 UTC
}

// ---------- approvals ----------
export interface ApprovalRequest {
  approvalId: string;
  findingId: string;
  proposalId: string;
  kind: "semantic_text" | "deterministic_preview";
  original: string;
  proposed: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "edited";
  editedText?: string;
  resolvedAt?: string;
}

// ---------- trace ----------
export type TraceType =
  | "audit.started"
  | "scan.completed"
  | "agent.plan"
  | "agent.tool_call"
  | "tool.result"
  | "agent.reason"
  | "policy.reject"
  | "approval.requested"
  | "approval.resolved"
  | "patch.applied"
  | "verify.result"
  | "evidence.generated"
  | "audit.completed"
  | "error";

export interface TraceEvent {
  seq: number;
  ts: string;
  type: TraceType;
  actor: "agent" | "engine" | "human"; // provenance shown in the UI
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string; // hash chain, Section 15.4
}

// ---------- audit ----------
export interface Audit {
  auditId: string; // "PRM-2026-000123" style, zero-padded counter
  projectName: string;
  startedAt: string;
  completedAt?: string;
  engineVersion: string;
  configHash: string;
  filesScanned: number;
  before: { total: number; high: number; medium: number; low: number };
  after?: { total: number; high: number; medium: number; low: number };
  findings: Finding[];
  status: "running" | "awaiting_approval" | "completed" | "completed_with_failures" | "error";
  evidenceHash?: string;
}

// ---------- evidence pack ----------
// Spec Section 15.2 — authoritative shape. Do not diverge from this.
export interface EvidencePack {
  schema: "pramaan.evidence/1";
  audit: Audit;
  engine: { version: string; node: string; playwright: string; regulationDataVersion: string };
  llm: { provider: string; model: string; temperature: number; mode: "live" | "replay" };
  config: Record<string, unknown>;
  files: { path: string; sha256Before: string; sha256After: string }[];
  findings: {
    finding: Finding;
    proposals: { proposal: PatchProposal; result: PatchResult; verify: VerifyResult | null }[];
    approvals: ApprovalRequest[];
  }[];
  artifacts: { path: string; sha256: string }[];
  traceHead: string; // last chain hash
  disclaimer: string;
  generatedAt: string;
  evidenceHash: string;
}

// ---------- errors ----------
export type ErrorCode =
  | "E_BAD_INPUT"
  | "E_NOT_FOUND"
  | "E_STATE_CONFLICT"
  | "E_INTERNAL"
  | "E_CONFIG_INVALID"
  | "E_PARSE_ERROR"
  | "E_UNKNOWN_PATTERN"
  | "E_UNKNOWN_STRATEGY"
  | "E_OP_NOT_ALLOWED"
  | "E_PATH_NOT_ALLOWED"
  | "E_TARGET_MISMATCH"
  | "E_TARGET_NOT_FOUND"
  | "E_PROPERTY_NOT_ALLOWED"
  | "E_PROTECTED_ELEMENT"
  | "E_APPROVAL_REQUIRED"
  | "E_TEXT_NOT_ALLOWED"
  | "E_TOO_MANY_OPS"
  | "E_PATCH_PARSE_ERROR"
  | "E_ALREADY_APPLIED"
  | "E_ATTEMPTS_EXHAUSTED"
  | "E_BUDGET_EXHAUSTED"
  | "E_LLM_UNAVAILABLE"
  | "E_LLM_BAD_OUTPUT"
  | "E_RUNTIME_UNAVAILABLE";

export type WarningCode =
  | "LABEL_NOT_FOUND"
  | "UNSUPPORTED_SELECTOR"
  | "UNSUPPORTED_STYLE_SOURCE"
  | "ANCESTOR_CONTEXT_UNKNOWN"
  | "EM_APPROXIMATED"
  | "BACKGROUND_ASSUMED_WHITE"
  | "COUNTDOWN_WITHOUT_URGENCY_TEXT"
  | "PRICE_FLOW_NOT_CONFIGURED"
  | "ONCHANGE_EXISTS"
  | "INJECTION_SUSPECTED"
  | "ROUTE_UNKNOWN";
