// Local, filesystem-only audit state for the CLI. Same directory layout as
// the server (.pramaan/audits/<auditId>/{state.json,trace.jsonl}) so state
// composes across `pramaan` invocations. Spec Section 16 intro.
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

export interface LocalAuditState {
  audit: Audit;
  sourceRoot: string;
  workspaceRoot: string;
  applied: boolean;
  approvals: ApprovalRequest[];
  proposals: PatchProposal[];
  results: PatchResult[];
  verifies: VerifyResult[];
}

export function pramaanDir(projectRoot: string): string {
  return path.join(projectRoot, ".pramaan");
}

export function auditDir(projectRoot: string, auditId: string): string {
  return path.join(pramaanDir(projectRoot), "audits", auditId);
}

export async function saveState(projectRoot: string, state: LocalAuditState): Promise<void> {
  const dir = auditDir(projectRoot, state.audit.auditId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "state.json"), JSON.stringify(state, null, 2), "utf-8");
}

export async function loadState(projectRoot: string, auditId: string): Promise<LocalAuditState | undefined> {
  try {
    const raw = await readFile(path.join(auditDir(projectRoot, auditId), "state.json"), "utf-8");
    return JSON.parse(raw) as LocalAuditState;
  } catch {
    return undefined;
  }
}

export async function loadTrace(projectRoot: string, auditId: string): Promise<TraceEvent[]> {
  try {
    const raw = await readFile(path.join(auditDir(projectRoot, auditId), "trace.jsonl"), "utf-8");
    return raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as TraceEvent);
  } catch {
    return [];
  }
}

export async function appendTrace(
  projectRoot: string,
  auditId: string,
  partial: { type: TraceType; actor: TraceEvent["actor"]; payload: Record<string, unknown> },
): Promise<TraceEvent> {
  const dir = auditDir(projectRoot, auditId);
  await mkdir(dir, { recursive: true });
  const existing = await loadTrace(projectRoot, auditId);
  const seq = existing.length > 0 ? existing[existing.length - 1]!.seq + 1 : 1;
  const chainTail = existing.at(-1)?.hash ?? GENESIS_HASH;
  const event = appendEvent(chainTail, {
    seq,
    ts: new Date().toISOString(),
    type: partial.type,
    actor: partial.actor,
    payload: partial.payload,
  });
  await appendFile(path.join(dir, "trace.jsonl"), `${JSON.stringify(event)}\n`, "utf-8");
  return event;
}

/** Most recently started audit under this project root, or undefined. */
export async function findLatestAuditId(projectRoot: string): Promise<string | undefined> {
  const auditsDir = path.join(pramaanDir(projectRoot), "audits");
  let entries: string[] = [];
  try {
    entries = (await readdir(auditsDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return undefined;
  }
  let latest: { id: string; mtime: number } | undefined;
  for (const id of entries) {
    try {
      const st = await stat(path.join(auditsDir, id, "state.json"));
      if (!latest || st.mtimeMs > latest.mtime) latest = { id, mtime: st.mtimeMs };
    } catch {
      // skip
    }
  }
  return latest?.id;
}

export async function findFinding(
  projectRoot: string,
  findingId: string,
  auditId?: string,
): Promise<{ state: LocalAuditState; finding: LocalAuditState["audit"]["findings"][number] } | undefined> {
  const ids = auditId ? [auditId] : [await findLatestAuditId(projectRoot)].filter((x): x is string => !!x);
  for (const id of ids) {
    const state = await loadState(projectRoot, id);
    const finding = state?.audit.findings.find((f) => f.findingId === findingId);
    if (state && finding) return { state, finding };
  }
  return undefined;
}
