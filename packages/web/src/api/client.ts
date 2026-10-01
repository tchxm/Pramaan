// REST client for the PRAMAAN server — Spec Section 17.1.
// The web app NEVER computes findings or verdicts itself; every function
// here is a thin fetch wrapper that returns server truth as-is.
import type {
  Audit,
  Finding,
  PatchProposal,
  ApprovalRequest,
  EvidencePack,
} from "../types/core";

export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8787";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (cause) {
    throw new ApiError("E_SERVER_UNREACHABLE", `The server isn't reachable at ${API_BASE_URL}.`, 0, {
      cause: String(cause),
    });
  }

  if (!res.ok) {
    let body: { error?: { code?: string; message?: string; details?: Record<string, unknown> } } = {};
    try {
      body = await res.json();
    } catch {
      // non-JSON error body; fall through to a generic message
    }
    throw new ApiError(
      body.error?.code ?? "E_INTERNAL",
      body.error?.message ?? `Request to ${path} failed with status ${res.status}`,
      res.status,
      body.error?.details,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------- health / fixtures ----------

export interface HealthResponse {
  ok: boolean;
  engineVersion: string;
  llm: { configured: boolean; model: string | null };
  runtime: { playwrightReady: boolean };
  mode: string;
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/api/health");
}

export interface FixtureExpectedFinding {
  ruleId: string;
  file: string;
  count: number;
  [key: string]: unknown;
}

export interface FixtureSummary {
  id: string;
  name: string;
  description: string;
  expected: { findings: FixtureExpectedFinding[]; patterns?: string[] };
}

export function getFixtures(): Promise<FixtureSummary[]> {
  return request<FixtureSummary[]>("/api/fixtures");
}

// ---------- audits ----------

export type AuditSource = { type: "fixture"; id: string } | { type: "path"; path: string };

export interface CreateAuditOptions {
  demoScenario?: "mixed-outcomes";
  runtime?: boolean;
  maxAttempts?: number;
  autoApprovePreview?: boolean;
}

export function createAudit(
  source: AuditSource,
  options?: CreateAuditOptions,
): Promise<{ auditId: string }> {
  return request("/api/audits", {
    method: "POST",
    body: JSON.stringify({ source, options }),
  });
}

export interface AuditDetail {
  audit: Audit;
  proposals: PatchProposal[];
  approvals: ApprovalRequest[];
  protectedManifest: unknown[];
}

export function getAudit(auditId: string): Promise<AuditDetail> {
  return request<AuditDetail>(`/api/audits/${auditId}`);
}

export function getAuditFile(
  auditId: string,
  path: string,
  version: "before" | "after",
): Promise<{ path: string; version: string; sha256: string; text: string }> {
  return request(`/api/audits/${auditId}/files?path=${encodeURIComponent(path)}&version=${version}`);
}

export function getAuditDiff(auditId: string, proposalId?: string): Promise<{ diff: string }> {
  const qs = proposalId ? `?proposalId=${encodeURIComponent(proposalId)}` : "";
  return request(`/api/audits/${auditId}/diff${qs}`);
}

export type ApprovalDecision = "approve" | "reject" | "edit" | "ignore";

export function resolveApproval(
  auditId: string,
  approvalId: string,
  decision: ApprovalDecision,
  editedText?: string,
): Promise<{ approval: ApprovalRequest }> {
  return request(`/api/audits/${auditId}/approvals/${approvalId}`, {
    method: "POST",
    body: JSON.stringify({ decision, editedText }),
  });
}

export function applyAudit(auditId: string): Promise<{ filesWritten: string[] }> {
  return request(`/api/audits/${auditId}/apply`, {
    method: "POST",
    body: JSON.stringify({ confirm: true }),
  });
}

export function getEvidencePack(auditId: string): Promise<EvidencePack> {
  return request<EvidencePack>(`/api/audits/${auditId}/evidence`);
}

export function reportUrl(auditId: string): string {
  return `${API_BASE_URL}/api/audits/${auditId}/report`;
}

export function evidenceUrl(auditId: string): string {
  return `${API_BASE_URL}/api/audits/${auditId}/evidence`;
}

export function artifactUrl(auditId: string, relPath: string): string {
  return `${API_BASE_URL}/api/audits/${auditId}/artifacts/${relPath}`;
}

export interface VerifyPackResponse {
  valid: boolean;
  checks: { name: string; pass: boolean; detail?: string }[];
}

export function verifyEvidencePack(pack: unknown, trace?: string): Promise<VerifyPackResponse> {
  return request("/api/evidence/verify", {
    method: "POST",
    body: JSON.stringify({ pack, trace }),
  });
}

export function eventsUrl(auditId: string): string {
  return `${API_BASE_URL}/api/audits/${auditId}/events`;
}

export type { Finding };
