// `pramaan evidence [--audit <id>]` — generates the pack and report.
// `pramaan evidence verify <path>` — checks a pack (Spec 15.5 / 16.1).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildEvidencePack, verifyEvidencePack, writeReportBundle, type EvidencePack, type TraceEvent } from "@pramaan/core";
import { findLatestAuditId, loadState, loadTrace } from "../localStore.js";

export async function runEvidenceGenerate(
  projectRoot: string,
  opts: { audit?: string; out?: string },
): Promise<number> {
  const auditId = opts.audit ?? (await findLatestAuditId(projectRoot));
  if (!auditId) {
    console.error("No audits found. Run `pramaan scan` or `pramaan audit` first.");
    return 2;
  }
  const state = await loadState(projectRoot, auditId);
  if (!state) {
    console.error(`Audit ${auditId} not found under ${projectRoot}/.pramaan/audits`);
    return 2;
  }
  const trace = await loadTrace(projectRoot, auditId);

  const pack = buildEvidencePack({
    audit: state.audit,
    engine: { version: "0.1.0", node: process.version, playwright: "unknown", regulationDataVersion: "india-1" },
    llm: { provider: "anthropic", model: "unset", temperature: 0, mode: "live" },
    config: {},
    files: [],
    findings: state.audit.findings.map((finding) => ({
      finding,
      proposals: state.proposals
        .filter((p) => p.findingId === finding.findingId)
        .map((proposal) => ({
          proposal,
          result: state.results.find((r) => r.proposalId === proposal.proposalId) ?? {
            proposalId: proposal.proposalId,
            applied: false,
            filesChanged: [],
            diff: "",
            policyViolations: [],
          },
          verify: state.verifies.find((v) => v.findingId === finding.findingId) ?? null,
        })),
      approvals: state.approvals.filter((a) => a.findingId === finding.findingId),
    })),
    artifacts: [],
    traceHead: trace.at(-1)?.hash ?? "0".repeat(64),
  });

  const reportRoot = path.resolve(process.cwd(), opts.out ?? "./pramaan-report");
  const outDir = path.join(reportRoot, auditId);
  const written = await writeReportBundle(pack, trace, outDir);

  console.log(`Wrote ${written.packPath}`);
  console.log(`Wrote ${written.indexPath}`);
  console.log(`Wrote ${written.readmePath}`);
  if (written.tracePath) console.log(`Wrote ${written.tracePath}`);
  return 0;
}

export async function runEvidenceVerify(packPath: string): Promise<number> {
  const absPack = path.resolve(process.cwd(), packPath);
  let pack: EvidencePack;
  try {
    pack = JSON.parse(await readFile(absPack, "utf-8")) as EvidencePack;
  } catch (cause) {
    console.error(`Could not read/parse pack at ${absPack}: ${cause instanceof Error ? cause.message : String(cause)}`);
    return 2;
  }

  let traceEvents: TraceEvent[] | undefined;
  const tracePath = path.join(path.dirname(absPack), "trace.jsonl");
  try {
    const raw = await readFile(tracePath, "utf-8");
    traceEvents = raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as TraceEvent);
  } catch {
    traceEvents = undefined;
  }

  const result = await verifyEvidencePack(pack, {
    traceEvents,
    artifactsRoot: path.dirname(absPack),
  });

  for (const check of result.checks) {
    console.log(`${check.passed ? "PASS" : "FAIL"}  ${check.name}${check.details ? `  — ${check.details}` : ""}`);
  }
  console.log(result.valid ? "VALID" : "INVALID");
  return result.valid ? 0 : 1;
}
