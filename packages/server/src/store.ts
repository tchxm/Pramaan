// In-memory audit store, persisted under .pramaan/audits/<auditId>/
// (state.json + trace.jsonl). Rebuilds its index from disk on startup.
// Spec Section 17.5.
import { mkdir, readFile, writeFile, appendFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  appendEvent,
  GENESIS_HASH,
  type Audit,
  type TraceEvent,
  type TraceType,
  type ApprovalRequest,
  type PatchProposal,
  type PatchResult,
  type VerifyResult,
} from "@pramaan/core";
import { runAudit, type RunAuditIO } from "@pramaan/agent";
import { nextAuditId } from "./counter.js";
import { randomSecret, mintApprovalToken, mintApprovalTokenFromHash, verifyApprovalTokenFromHash } from "./security.js";

export const ENGINE_VERSION = "0.1.0";

export type AuditSource = { type: "fixture"; id: string } | { type: "path"; path: string };

export interface CreateAuditOptions {
  runtime?: boolean;
  maxAttempts?: number;
  autoApprovePreview?: boolean;
  configPath?: string;
  model?: string;
}

interface PersistedState {
  audit: Audit;
  source: AuditSource;
  options: CreateAuditOptions;
  sourceRoot: string;
  workspaceRoot: string;
  applied: boolean;
  approvals: ApprovalRequest[];
  proposals: PatchProposal[];
  results: PatchResult[];
  verifies: VerifyResult[];
}

interface AuditRecord extends PersistedState {
  dir: string;
  trace: TraceEvent[];
  chainTail: string;
  secret: Buffer;
  approvalTokens: Map<string, string>; // approvalId -> minted token (never exposed to agent)
  pendingApprovalResolvers: Map<string, (req: ApprovalRequest) => void>;
  subscribers: Set<(event: TraceEvent) => void>;
}

export interface SseSnapshotPayload {
  audit: Audit;
  findings: Audit["findings"];
  pendingApprovals: ApprovalRequest[];
}

export class AuditStore {
  private records = new Map<string, AuditRecord>();
  private readonly baseDir: string; // <root>/.pramaan
  private readonly auditsDir: string; // <root>/.pramaan/audits

  constructor(private readonly root: string = process.cwd()) {
    this.baseDir = path.join(root, ".pramaan");
    this.auditsDir = path.join(this.baseDir, "audits");
  }

  async init(): Promise<void> {
    await mkdir(this.auditsDir, { recursive: true });
    let entries: string[] = [];
    try {
      entries = (await readdir(this.auditsDir, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      entries = [];
    }
    for (const auditId of entries) {
      try {
        await this.loadFromDisk(auditId);
      } catch (cause) {
        // Corrupt audit directory: skip rather than crash the server.
        console.error(`[store] failed to load audit ${auditId} from disk:`, cause);
      }
    }
  }

  private async loadFromDisk(auditId: string): Promise<void> {
    const dir = path.join(this.auditsDir, auditId);
    const stateRaw = await readFile(path.join(dir, "state.json"), "utf-8");
    const state = JSON.parse(stateRaw) as PersistedState;

    let trace: TraceEvent[] = [];
    try {
      const traceRaw = await readFile(path.join(dir, "trace.jsonl"), "utf-8");
      trace = traceRaw
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as TraceEvent);
    } catch {
      trace = [];
    }

    const record: AuditRecord = {
      ...state,
      dir,
      trace,
      chainTail: trace.at(-1)?.hash ?? GENESIS_HASH,
      secret: randomSecret(), // secrets are not persisted; re-approval after restart mints a new one
      approvalTokens: new Map(),
      pendingApprovalResolvers: new Map(),
      subscribers: new Set(),
    };
    this.records.set(auditId, record);
  }

  private async persistState(record: AuditRecord): Promise<void> {
    const state: PersistedState = {
      audit: record.audit,
      source: record.source,
      options: record.options,
      sourceRoot: record.sourceRoot,
      workspaceRoot: record.workspaceRoot,
      applied: record.applied,
      approvals: [...record.approvals],
      proposals: [...record.proposals],
      results: [...record.results],
      verifies: [...record.verifies],
    };
    await writeFile(path.join(record.dir, "state.json"), JSON.stringify(state, null, 2), "utf-8");
  }

  get(auditId: string): AuditRecord | undefined {
    return this.records.get(auditId);
  }

  list(): Audit[] {
    return [...this.records.values()]
      .map((r) => r.audit)
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }

  /** Workspace root convention matches @pramaan/core createWorkspace(). */
  static workspaceRootFor(sourceRoot: string, auditId: string): string {
    return path.join(sourceRoot, ".pramaan", "workspaces", auditId);
  }

  async createAudit(source: AuditSource, options: CreateAuditOptions, sourceRoot: string): Promise<string> {
    const auditId = await nextAuditId(this.baseDir);
    const dir = path.join(this.auditsDir, auditId);
    await mkdir(dir, { recursive: true });

    const audit: Audit = {
      auditId,
      projectName: path.basename(sourceRoot),
      startedAt: new Date().toISOString(),
      engineVersion: ENGINE_VERSION,
      configHash: "",
      filesScanned: 0,
      before: { total: 0, high: 0, medium: 0, low: 0 },
      findings: [],
      status: "running",
    };

    const record: AuditRecord = {
      audit,
      source,
      options,
      sourceRoot,
      workspaceRoot: AuditStore.workspaceRootFor(sourceRoot, auditId),
      applied: false,
      approvals: [],
      proposals: [],
      results: [],
      verifies: [],
      dir,
      trace: [],
      chainTail: GENESIS_HASH,
      secret: randomSecret(),
      approvalTokens: new Map(),
      pendingApprovalResolvers: new Map(),
      subscribers: new Set(),
    };
    this.records.set(auditId, record);
    await this.persistState(record);

    await this.appendTrace(auditId, {
      type: "audit.started",
      actor: "engine",
      payload: { source, options },
    });

    // Fire-and-forget: run the audit in the background. A7 integrates
    // against the runAudit(options, io) black box; until A6 lands this
    // throws "not implemented yet" and we surface that honestly as an
    // error-status audit rather than fabricating results.
    void this.run(auditId).catch((cause) => {
      console.error(`[store] unexpected error running audit ${auditId}:`, cause);
    });

    return auditId;
  }

  private async run(auditId: string): Promise<void> {
    const record = this.get(auditId);
    if (!record) return;

    const io: RunAuditIO = {
      emit: (event) => {
        void this.appendTrace(auditId, {
          type: event.type,
          actor: event.actor,
          payload: event.payload,
        });
      },
      requestApproval: async (request) => {
        record.approvals.push(request);
        await this.persistState(record);
        await this.appendTrace(auditId, {
          type: "approval.requested",
          actor: "engine",
          payload: { approval: request },
        });
      },
      onApprovalResolved: (approvalId) =>
        new Promise<ApprovalRequest>((resolve) => {
          const existing = record.approvals.find((a) => a.approvalId === approvalId);
          if (existing && existing.status !== "pending") {
            resolve(existing);
            return;
          }
          record.pendingApprovalResolvers.set(approvalId, resolve);
        }),
      // Wire the server's REAL per-audit HMAC secret (record.secret) into
      // the agent's approval handshake, so a token minted here is the one
      // actually checked by patch/policy's P6 inside applyPatch — instead
      // of the agent package's local in-process fallback secret. Spec 14.9 /
      // I-06: the agent never sees the secret, only these two functions.
      mintApprovalToken: (info) =>
        mintApprovalTokenFromHash(record.secret, info.auditId, info.findingId, info.proposalId, info.textSha256),
      verifyApprovalToken: (token, info) =>
        verifyApprovalTokenFromHash(record.secret, token, info.auditId, info.findingId, info.proposalId, info.textSha256),
    };

    try {
      const finalAudit = await runAudit(
        {
          projectRoot: record.sourceRoot,
          configPath: record.options.configPath ?? path.join(record.sourceRoot, "pramaan.config.json"),
          auditId,
          maxToolCalls: undefined,
          maxAttemptsPerFinding: record.options.maxAttempts,
          runtimeEnabled: record.options.runtime,
          autoApprovePreview: record.options.autoApprovePreview,
          mode: "live",
        },
        io,
      );
      record.audit = finalAudit;
    } catch (cause) {
      record.audit = {
        ...record.audit,
        status: "error",
        completedAt: new Date().toISOString(),
      };
      await this.appendTrace(auditId, {
        type: "error",
        actor: "engine",
        payload: {
          message: cause instanceof Error ? cause.message : String(cause),
          code: (cause as { code?: string })?.code ?? "E_INTERNAL",
        },
      });
    }
    await this.persistState(record);
  }

  resolveApproval(
    auditId: string,
    approvalId: string,
    decision: "approve" | "reject" | "edit" | "ignore",
    editedText: string | undefined,
  ): { approval: ApprovalRequest; token?: string } {
    const record = this.get(auditId);
    if (!record) {
      throw new Error("audit not found");
    }
    const approval = record.approvals.find((a) => a.approvalId === approvalId);
    if (!approval) {
      throw Object.assign(new Error("approval not found"), { code: "E_NOT_FOUND" });
    }
    if (approval.status !== "pending") {
      throw Object.assign(new Error("approval already resolved"), { code: "E_STATE_CONFLICT" });
    }

    const statusMap = {
      approve: "approved",
      reject: "rejected",
      edit: "edited",
      ignore: "rejected",
    } as const;
    approval.status = statusMap[decision];
    approval.resolvedAt = new Date().toISOString();
    if (decision === "edit" && editedText !== undefined) {
      approval.editedText = editedText;
    }

    let token: string | undefined;
    if (decision === "approve" || decision === "edit") {
      const to = decision === "edit" && editedText !== undefined ? editedText : approval.proposed;
      token = mintApprovalToken(record.secret, auditId, approval.findingId, approval.proposalId, to);
      record.approvalTokens.set(approvalId, token);
    }

    void this.persistState(record);
    void this.appendTrace(auditId, {
      type: "approval.resolved",
      actor: "human",
      payload: { approvalId, decision, approval },
    });

    const resolver = record.pendingApprovalResolvers.get(approvalId);
    if (resolver) {
      resolver(approval);
      record.pendingApprovalResolvers.delete(approvalId);
    }

    return { approval, token };
  }

  async appendTrace(
    auditId: string,
    partial: { type: TraceType; actor: TraceEvent["actor"]; payload: Record<string, unknown> },
  ): Promise<TraceEvent> {
    const record = this.get(auditId);
    if (!record) throw new Error(`unknown audit ${auditId}`);

    const seq = record.trace.length > 0 ? record.trace[record.trace.length - 1]!.seq + 1 : 1;
    const event = appendEvent(record.chainTail, {
      seq,
      ts: new Date().toISOString(),
      type: partial.type,
      actor: partial.actor,
      payload: partial.payload,
    });
    record.trace.push(event);
    record.chainTail = event.hash;
    await appendFile(path.join(record.dir, "trace.jsonl"), `${JSON.stringify(event)}\n`, "utf-8");
    for (const sub of record.subscribers) sub(event);
    return event;
  }

  /** Synthetic audit.snapshot payload, sent immediately on SSE connect. */
  snapshot(auditId: string): SseSnapshotPayload | undefined {
    const record = this.get(auditId);
    if (!record) return undefined;
    return {
      audit: record.audit,
      findings: record.audit.findings,
      pendingApprovals: record.approvals.filter((a) => a.status === "pending"),
    };
  }

  /** Events with seq greater than `afterSeq`, for Last-Event-ID replay. */
  eventsAfter(auditId: string, afterSeq: number): TraceEvent[] {
    const record = this.get(auditId);
    if (!record) return [];
    return record.trace.filter((e) => e.seq > afterSeq);
  }

  subscribe(auditId: string, cb: (event: TraceEvent) => void): () => void {
    const record = this.get(auditId);
    if (!record) return () => {};
    record.subscribers.add(cb);
    return () => record.subscribers.delete(cb);
  }

  markApplied(auditId: string): void {
    const record = this.get(auditId);
    if (!record) return;
    record.applied = true;
    void this.persistState(record);
  }

  isApplied(auditId: string): boolean {
    return this.get(auditId)?.applied ?? false;
  }
}

export async function pathIsDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}
