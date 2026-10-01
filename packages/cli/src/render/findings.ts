import type { Finding } from "@pramaan/core";
import { DISCLAIMER } from "@pramaan/core";

export function renderFindingsList(findings: Finding[]): string {
  if (findings.length === 0) return "0 findings";
  const lines = [`${findings.length} finding${findings.length === 1 ? "" : "s"}`, ""];
  for (const f of findings) {
    const loc = `${f.location.file}:${f.location.startLine}`;
    const extra = f.requiresReview && f.score !== null ? `   potential · score ${f.score.toFixed(2)}` : "";
    lines.push(
      `  ${f.findingId.padEnd(8)} ${f.severity.padEnd(7)} ${f.title.padEnd(24)} ${loc}${extra}`,
    );
  }
  return lines.join("\n");
}

export function renderFooter(auditId: string, workspaceRoot: string): string {
  return `\nAudit ${auditId} · workspace ${workspaceRoot}\n${DISCLAIMER}`;
}
