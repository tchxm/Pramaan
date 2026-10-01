import type { Finding, TraceEvent, VerifyResult } from "../../types/core";

export function reviewLabel(finding: Finding, hasProposal: boolean): string | undefined {
  const reason = finding.failure?.data?.summary;
  return finding.status === "failed" && typeof reason === "string" && reason.startsWith("Demo ") ? hasProposal ? "Proposal ready · not applied" : "Needs human review" : undefined;
}

export function findingProgressLabel(finding: Finding, hasProposal: boolean, verify?: VerifyResult, evidenceReady = false): string {
  if (verify?.verdict === "VERIFIED" || verify?.verdict === "STATIC_VERIFIED") return evidenceReady ? "Verified · evidence recorded" : "Verified · preparing evidence";
  if (verify?.verdict === "FAILED") return "Verification failed · review needed";
  if (finding.status === "failed") return hasProposal ? "Stopped at proposal" : "No proposal · review needed";
  if (finding.status === "remediating") return "Fix applied · checking gates";
  return hasProposal ? "Proposal generated" : "Investigating · no proposal yet";
}

export default function FindingJourney({ finding, hasProposal, verify, events }: {
  finding: Finding; hasProposal: boolean; verify?: VerifyResult; events: TraceEvent[];
}) {
  const applied = events.some(e => e.type === "patch.applied" && e.payload.findingId === finding.findingId && (e.payload.result as { applied?: boolean })?.applied);
  const evidence = events.some(e => e.type === "evidence.generated");
  const passed = verify?.verdict === "VERIFIED" || verify?.verdict === "STATIC_VERIFIED";
  const stopped = finding.status === "failed";
  const steps = [
    { label: "Detected", done: true },
    { label: "Investigated", done: hasProposal || stopped || !!verify },
    { label: "Proposal", done: hasProposal },
    { label: "Applied", done: applied },
    { label: "Verified", done: passed },
    { label: "Evidence", done: passed && evidence },
  ];
  const summary = finding.failure?.data?.summary;
  return <section className="ws-finding-journey" aria-label="Finding progress">
    <h3>{findingProgressLabel(finding, hasProposal, verify, evidence)}</h3>
    <ol>{steps.map((s, i) => <li key={s.label} data-state={s.done ? "done" : stopped ? "not-run" : steps[i - 1]?.done ? "current" : "not-run"}>{s.done ? "✓ " : "○ "}{s.label}</li>)}</ol>
    {typeof summary === "string" && <p>{summary}</p>}
    {stopped && !hasProposal && <p>No fix proposal exists for this finding. It remains unresolved for review.</p>}
    {stopped && hasProposal && !applied && <p>The proposal is available below. It was not applied, and its verification gates were not run.</p>}
    {passed && <p>The verdict comes from the engine’s checks{verify?.verdict === "STATIC_VERIFIED" ? "; browser checks were not run" : ""}. Other unresolved findings do not become verified.</p>}
  </section>;
}
