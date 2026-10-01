import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Audit, EvidencePack, TraceEvent } from "../types.js";
import { canonicalJson } from "./canonical.js";
import { verifyChain } from "./chain.js";
import { DISCLAIMER } from "../constants.js";

export { DISCLAIMER };

export interface BuildEvidencePackInput {
  audit: Audit;
  engine: EvidencePack["engine"];
  llm: EvidencePack["llm"];
  config: Record<string, unknown>;
  files: EvidencePack["files"];
  findings: EvidencePack["findings"];
  artifacts: EvidencePack["artifacts"];
  traceHead: string;
}

export function hashEvidencePack(pack: Omit<EvidencePack, "evidenceHash">): string {
  return createHash("sha256").update(canonicalJson(pack)).digest("hex");
}

/**
 * Builds the evidence pack. Spec Section 15.2. Called automatically by the
 * agent loop once every finding is terminal.
 */
export function buildEvidencePack(input: BuildEvidencePackInput): EvidencePack {
  const withoutHash: Omit<EvidencePack, "evidenceHash"> = {
    schema: "pramaan.evidence/1",
    audit: input.audit,
    engine: input.engine,
    llm: input.llm,
    config: input.config,
    files: input.files,
    findings: input.findings,
    artifacts: input.artifacts,
    traceHead: input.traceHead,
    disclaimer: DISCLAIMER,
    generatedAt: new Date().toISOString(),
  };
  const evidenceHash = hashEvidencePack(withoutHash);
  return { ...withoutHash, evidenceHash };
}

export interface VerifyCheck {
  name: string;
  passed: boolean;
  details?: string;
}

export interface VerifyPackResult {
  valid: boolean;
  checks: VerifyCheck[];
}

/**
 * Recomputes pack hash, chain over trace.jsonl, traceHead equality, and the
 * SHA-256 of every listed artifact. Spec Section 15 (verifyPack.ts).
 */
export async function verifyEvidencePack(
  pack: EvidencePack,
  opts: { traceEvents?: TraceEvent[]; artifactsRoot?: string } = {},
): Promise<VerifyPackResult> {
  const checks: VerifyCheck[] = [];

  const { evidenceHash, ...rest } = pack;
  const recomputed = hashEvidencePack(rest);
  checks.push({
    name: "evidence_hash",
    passed: recomputed === evidenceHash,
    details: recomputed === evidenceHash ? undefined : `expected ${evidenceHash}, got ${recomputed}`,
  });

  if (opts.traceEvents) {
    const chainResult = verifyChain(opts.traceEvents);
    checks.push({
      name: "trace_chain",
      passed: chainResult.valid,
      details: chainResult.valid ? undefined : `chain broken at seq ${chainResult.brokenAtSeq}`,
    });

    const tail = opts.traceEvents.at(-1);
    checks.push({
      name: "trace_head",
      passed: tail?.hash === pack.traceHead,
      details: tail?.hash === pack.traceHead ? undefined : "trace tail hash does not match pack.traceHead",
    });
  }

  if (opts.artifactsRoot) {
    for (const artifact of pack.artifacts) {
      try {
        const buf = await readFile(path.join(opts.artifactsRoot, artifact.path));
        const actual = createHash("sha256").update(buf).digest("hex");
        checks.push({
          name: `artifact:${artifact.path}`,
          passed: actual === artifact.sha256,
          details: actual === artifact.sha256 ? undefined : "artifact content hash mismatch",
        });
      } catch (cause) {
        checks.push({ name: `artifact:${artifact.path}`, passed: false, details: String(cause) });
      }
    }
  }

  return { valid: checks.every((c) => c.passed), checks };
}
