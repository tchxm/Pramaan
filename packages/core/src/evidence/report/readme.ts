// Plain-text README.txt for the pramaan-report/<auditId>/ directory —
// Spec Section 15.1 (directory layout) and 15.8 (honest limits printed
// in README.txt). Pure string-building only, no I/O.

import type { EvidencePack } from "../../types.js";
import { DISCLAIMER } from "../pack.js";

/**
 * Renders the plain-text README.txt that ships alongside index.html,
 * evidence-pack.json and trace.jsonl in a report bundle.
 */
export function renderReadmeTxt(pack: EvidencePack): string {
  const lines: string[] = [];

  lines.push(`Pramaan evidence report — ${pack.audit.auditId}`);
  lines.push("=".repeat(40 + pack.audit.auditId.length));
  lines.push("");
  lines.push(`Project: ${pack.audit.projectName}`);
  lines.push(`Generated: ${pack.generatedAt}`);
  lines.push(`Engine version: ${pack.engine.version}`);
  lines.push(`Model: ${pack.llm.model} (mode: ${pack.llm.mode})`);
  lines.push("");
  lines.push("WHAT THIS IS");
  lines.push("-------------");
  lines.push(
    "This directory is a self-contained evidence pack produced by a Pramaan audit. " +
      "It records the deceptive-interface patterns the engine detected, the remediation " +
      "proposals the agent made, the deterministic gate results that decided whether each " +
      "fix was verified, and a hash-chained trace of every step taken during the audit.",
  );
  lines.push("");
  lines.push("Files in this directory:");
  lines.push("  index.html          self-contained HTML viewer for this report");
  lines.push("  evidence-pack.json  the canonical evidence pack (pretty-printed JSON)");
  lines.push("  trace.jsonl         one hash-chained trace event per line (if recorded)");
  lines.push("  diffs/              per-proposal and cumulative unified diffs");
  lines.push("  screenshots/        before/after screenshots per finding, where captured");
  lines.push("  README.txt          this file");
  lines.push("");
  lines.push("HOW TO VERIFY");
  lines.push("--------------");
  lines.push(
    `Run "pramaan evidence verify ${pack.audit.auditId}" (or point the command at this ` +
      "directory) to recompute the evidence hash and the trace hash chain from the files here " +
      "and confirm they still match the values recorded in evidence-pack.json. " +
      "If anything in this directory was edited after it was generated, verification will fail.",
  );
  lines.push("");
  lines.push(`Evidence hash: ${pack.evidenceHash}`);
  lines.push(`Trace head:    ${pack.traceHead}`);
  lines.push("");
  lines.push("HONEST LIMITS");
  lines.push("-------------");
  lines.push("- The evidence hash is unsigned. It detects edits made after generation; it does");
  lines.push("  not prove who generated this pack or certify their identity.");
  lines.push("- All timestamps in this pack come from the local clock of the machine that ran");
  lines.push("  the audit, not from a trusted external time source.");
  lines.push("- Detectors cover a fixed set of pattern families (basket sneaking, false urgency,");
  lines.push("  interface interference, drip pricing, confirm shaming) for the configured scope.");
  lines.push("  Deceptive patterns outside that scope are not detected.");
  lines.push("- This report does not provide legal certification.");
  lines.push("");
  lines.push("DISCLAIMER");
  lines.push("----------");
  lines.push(pack.disclaimer || DISCLAIMER);
  lines.push("");

  return lines.join("\n");
}
