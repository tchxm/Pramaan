// Shared test harness for the agent-loop tests (T-AG-07/08/09 + F06 replay
// + prompt-injection). Runs runAudit() against real fixtures under
// fixtures/**, using a real @pramaan/core engine end-to-end and only
// mocking the LLM (MockLLMClient). No network calls ever happen.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, cp, rm, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { TraceEvent, ApprovalRequest } from "@pramaan/core";
import type { RunAuditIO } from "../src/runAudit.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_ROOT = path.resolve(here, "..", "..", "..", "fixtures");

/** Copies a fixture project into an isolated tmp directory so tests never
 * write .pramaan/ workspace artifacts back into the repo's fixtures/. Node
 * module resolution for `npm run build` still works because `npm` walks up
 * parent directories looking for node_modules, and npm workspaces hoist
 * fixture dependencies to the repo root — EXCEPT a tmp dir outside the repo
 * won't find them. So instead of a tmp copy, tests that need a real build
 * use the fixture in place and clean up their own `.pramaan/` afterward. */
export async function fixtureProjectRoot(name: string): Promise<string> {
  return path.join(FIXTURES_ROOT, name);
}

export async function cleanupAuditWorkspace(projectRoot: string, auditId: string): Promise<void> {
  await rm(path.join(projectRoot, ".pramaan", "workspaces", auditId), { recursive: true, force: true });
}

export async function cleanupReportDir(projectRoot: string, dirName = "pramaan-report"): Promise<void> {
  await rm(path.join(projectRoot, dirName), { recursive: true, force: true });
}

/** A fixture copy for tests, placed INSIDE the repo tree (under
 * `fixtures/.tmp-agent-tests/`, gitignored) rather than the OS tmp dir —
 * `npm run build` resolves `vite`/`tsc` by walking up parent directories to
 * the repo root's hoisted node_modules, which only works if the copy stays
 * inside the repo. An OS-tmpdir copy breaks that resolution entirely (see
 * KNOWN RISKS: this bit a first draft of the success-path test, which hung
 * on `npm run build` trying to resolve a missing `vite`). */
export async function isolatedFixtureCopy(name: string): Promise<string> {
  const src = path.join(FIXTURES_ROOT, name);
  const scratchRoot = path.join(FIXTURES_ROOT, ".tmp-agent-tests");
  await mkdir(scratchRoot, { recursive: true });
  const dest = await mkdtemp(path.join(scratchRoot, "pramaan-agent-test-"));
  await cp(src, dest, {
    recursive: true,
    filter: (source) => !/[\\/](node_modules|dist|\.pramaan|\.git)([\\/]|$)/.test(source),
  });
  return dest;
}

export function newAuditId(): string {
  return `TEST-${randomUUID().slice(0, 8)}`;
}

export interface TestIO extends RunAuditIO {
  events: TraceEvent[];
  approvalsSeen: ApprovalRequest[];
  /** Resolve a pending approval.request suspension from the test. */
  resolve(approvalId: string, result: ApprovalRequest): void;
}

/** Builds a RunAuditIO whose approval.request suspension is resolved by
 * calling `io.resolve(approvalId, request)` from the test — or, if
 * `autoApprove` is set, immediately approves every request. */
export function makeTestIO(autoApprove = false): TestIO {
  const events: TraceEvent[] = [];
  const approvalsSeen: ApprovalRequest[] = [];
  const resolvers = new Map<string, (req: ApprovalRequest) => void>();
  const resolved = new Map<string, ApprovalRequest>();

  const io: TestIO = {
    events,
    approvalsSeen,
    emit: (event) => {
      events.push(event);
    },
    requestApproval: async (request) => {
      approvalsSeen.push(request);
      if (autoApprove) {
        const approved: ApprovalRequest = { ...request, status: "approved", resolvedAt: new Date().toISOString() };
        resolved.set(request.approvalId, approved);
        const resolver = resolvers.get(request.approvalId);
        if (resolver) resolver(approved);
      }
    },
    onApprovalResolved: (approvalId) =>
      new Promise<ApprovalRequest>((res) => {
        const already = resolved.get(approvalId);
        if (already) {
          res(already);
          return;
        }
        resolvers.set(approvalId, res);
      }),
    resolve: (approvalId, result) => {
      resolved.set(approvalId, result);
      const resolver = resolvers.get(approvalId);
      if (resolver) resolver(result);
    },
  };
  return io;
}
