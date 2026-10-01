// Self-contained HTML evidence report — Spec Section 15.6.
//
// Pure string-building only: no filesystem or network I/O happens here
// (writeReportBundle.ts owns all disk writes). Every byte of content is
// derived from the EvidencePack/TraceEvent[] passed in, so the report
// "contains nothing the hash does not cover" (spec 15.6 closing line).
//
// Screenshots are referenced as RELATIVE file paths next to the report
// (./screenshots/<findingId>-before.png / -after.png) rather than inlined
// as base64. This keeps the generator simple and the report small; the
// <img onerror> fallback means a missing screenshot (expected for
// STATIC_VERIFIED-only audits where runtime never ran) degrades to a
// plain text note instead of a broken report.
//
// XSS / I-07: every string that originates from scanned source code
// (finding titles, evidence snippets, observed values, diff text, trace
// payloads, regulation text, approval text) is untrusted and MUST be
// passed through escapeHtml() before being placed in the HTML output.

import type {
  ApprovalRequest,
  EvidencePack,
  FailureReason,
  Finding,
  GateResult,
  PatchProposal,
  PatchResult,
  RegulationRef,
  Signal,
  TraceEvent,
  VerifyResult,
} from "../../types.js";
import { DISCLAIMER } from "../pack.js";

// ---------- escaping ----------

/** Escapes &, <, >, ", ' for safe insertion into HTML text/attribute contexts. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return escapeHtml(value);
  if (typeof value === "number" || typeof value === "boolean") return escapeHtml(String(value));
  return escapeHtml(JSON.stringify(value));
}

// ---------- copy strings, spec 18.6 (verbatim) ----------

const COPY = {
  gatesBanner: "Verdicts come from the deterministic engine, not the model.",
  statusOpen: "Open",
  statusAwaitingApproval: "Waiting for your approval",
  statusVerified: "Fixed and verified",
  statusStaticVerified: "Fixed, static checks only",
  statusFailed: "Fix failed. Human review needed",
  statusIgnored: "Ignored by you",
  interfaceInterferenceLabel: "Potential interface interference",
  regulationUnverified: "Reference not yet checked against the gazette",
} as const;

function statusCopy(status: Finding["status"]): string {
  switch (status) {
    case "open":
      return COPY.statusOpen;
    case "remediating":
      return "Remediating";
    case "awaiting_approval":
      return COPY.statusAwaitingApproval;
    case "verified":
      return COPY.statusVerified;
    case "static_verified":
      return COPY.statusStaticVerified;
    case "failed":
      return COPY.statusFailed;
    case "ignored":
      return COPY.statusIgnored;
    default:
      return status;
  }
}

// ---------- small helpers ----------

function fmtCounts(c: { total: number; high: number; medium: number; low: number }): string {
  return `${c.total} total (${c.high} high / ${c.medium} medium / ${c.low} low)`;
}

function screenshotPath(findingId: string, when: "before" | "after"): string {
  return `./screenshots/${findingId}-${when}.png`;
}

// ---------- fragments ----------

function renderHeader(pack: EvidencePack): string {
  return `
  <header class="report-header">
    <h1>${esc(pack.audit.projectName)}</h1>
    <dl class="meta-grid">
      <div><dt>Audit ID</dt><dd><code>${esc(pack.audit.auditId)}</code></dd></div>
      <div><dt>Engine version</dt><dd><code>${esc(pack.engine.version)}</code></dd></div>
      <div><dt>Model</dt><dd><code>${esc(pack.llm.model)}</code></dd></div>
      <div><dt>LLM mode</dt><dd><code>${esc(pack.llm.mode)}</code></dd></div>
      <div><dt>Generated at</dt><dd><code>${esc(pack.generatedAt)}</code></dd></div>
      <div><dt>Files scanned</dt><dd>${esc(pack.audit.filesScanned)}</dd></div>
      <div><dt>Audit status</dt><dd>${esc(pack.audit.status)}</dd></div>
    </dl>
  </header>`;
}

function renderBeforeAfter(pack: EvidencePack): string {
  const before = pack.audit.before;
  const after = pack.audit.after;
  return `
  <section class="before-after" aria-label="Before and after counts">
    <h2>Findings</h2>
    <p class="counts-summary">
      <span class="count-before">${esc(before.total)}</span>
      <span class="arrow" aria-hidden="true">&rarr;</span>
      <span class="count-after">${after ? esc(after.total) : "—"}</span>
    </p>
    <table class="counts-table">
      <thead><tr><th></th><th>Total</th><th>High</th><th>Medium</th><th>Low</th></tr></thead>
      <tbody>
        <tr><th>Before</th><td>${esc(before.total)}</td><td>${esc(before.high)}</td><td>${esc(before.medium)}</td><td>${esc(before.low)}</td></tr>
        <tr><th>After</th>${
          after
            ? `<td>${esc(after.total)}</td><td>${esc(after.high)}</td><td>${esc(after.medium)}</td><td>${esc(after.low)}</td>`
            : `<td colspan="4">not yet computed</td>`
        }</tr>
      </tbody>
    </table>
  </section>`;
}

function renderSignalsTable(signals: Signal[]): string {
  if (signals.length === 0) return `<p class="empty-note">No signals recorded.</p>`;
  const rows = signals
    .map(
      (s) => `
        <tr>
          <td><code>${esc(s.id)}</code></td>
          <td>${s.fired ? "fired" : "not fired"}</td>
          <td>${esc(s.weight)}</td>
          <td><code>${esc(s.observed)}</code></td>
        </tr>`,
    )
    .join("");
  return `
    <table class="signals-table">
      <thead><tr><th>Signal</th><th>Fired</th><th>Weight</th><th>Observed</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderRegulation(regulation: RegulationRef[]): string {
  if (regulation.length === 0) return `<p class="empty-note">No regulatory references recorded.</p>`;
  return regulation
    .map(
      (r) => `
      <div class="regulation-ref">
        <p><strong>${esc(r.framework)}</strong> — ${esc(r.patternName)}</p>
        <p class="plain-basis">${esc(r.plainBasis)}</p>
        <p class="audit-duty"><code>${esc(r.auditDuty)}</code></p>
        ${!r.verifiedAgainstGazette ? `<p class="unverified-note">${esc(COPY.regulationUnverified)}</p>` : ""}
      </div>`,
    )
    .join("");
}

function renderDiff(diff: string): string {
  if (!diff.trim()) return `<p class="empty-note">No diff recorded.</p>`;
  const lines = diff.split("\n").map((line) => {
    let cls = "diff-ctx";
    if (line.startsWith("+") && !line.startsWith("+++")) cls = "diff-add";
    else if (line.startsWith("-") && !line.startsWith("---")) cls = "diff-del";
    else if (line.startsWith("@@")) cls = "diff-hunk";
    return `<span class="${cls}">${esc(line)}</span>`;
  });
  return `<pre class="diff-view"><code>${lines.join("\n")}</code></pre>`;
}

function renderGateTable(verify: VerifyResult | null): string {
  if (!verify) {
    return `<p class="empty-note">No verify result recorded for this proposal.</p>`;
  }
  const rows = verify.gates
    .map(
      (g: GateResult) => `
        <tr>
          <td><code>${esc(g.gate)}</code></td>
          <td class="gate-status gate-${esc(g.status)}">${esc(g.status)}</td>
          <td><code>${esc(g.details)}</code></td>
        </tr>`,
    )
    .join("");
  const failureReasons = renderFailureReasons(verify.failureReasons);
  return `
    <p class="gates-banner">${esc(COPY.gatesBanner)}</p>
    <table class="gates-table">
      <thead><tr><th>Gate</th><th>Status</th><th>Details</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="verdict verdict-${esc(verify.verdict)}">Verdict: ${esc(verify.verdict)}</p>
    ${failureReasons}`;
}

function renderFailureReasons(reasons: FailureReason[]): string {
  if (reasons.length === 0) return "";
  const items = reasons
    .map((r) => `<li><code>${esc(r.code)}</code>: ${esc(r.message)} <code>${esc(r.data)}</code></li>`)
    .join("");
  return `<ul class="failure-reasons">${items}</ul>`;
}

function renderProposal(
  proposal: PatchProposal,
  result: PatchResult,
  verify: VerifyResult | null,
): string {
  return `
    <div class="proposal-card">
      <h4>Proposal <code>${esc(proposal.proposalId)}</code> — strategy <code>${esc(proposal.strategy)}</code></h4>
      <p class="proposal-rationale">${esc(proposal.rationale)}</p>
      <p>Risk: <code>${esc(proposal.risk)}</code> &middot; Applied: ${result.applied ? "yes" : "no"} &middot; Files changed: ${esc(result.filesChanged.length)}</p>
      ${renderDiff(result.diff)}
      ${renderGateTable(verify)}
    </div>`;
}

function renderApprovals(approvals: ApprovalRequest[]): string {
  if (approvals.length === 0) return `<p class="empty-note">No approvals were required for this finding.</p>`;
  return approvals
    .map(
      (a) => `
      <div class="approval-card">
        <p><strong>Approval</strong> <code>${esc(a.approvalId)}</code> &middot; kind <code>${esc(a.kind)}</code> &middot; status <code>${esc(a.status)}</code></p>
        <p class="approval-original">Original: <span>${esc(a.original)}</span></p>
        <p class="approval-proposed">Proposed: <span>${esc(a.proposed)}</span></p>
        ${a.editedText ? `<p class="approval-edited">Edited: <span>${esc(a.editedText)}</span></p>` : ""}
        <p class="approval-reason">Reason: ${esc(a.reason)}</p>
        ${a.resolvedAt ? `<p class="approval-resolved">Resolved at: <code>${esc(a.resolvedAt)}</code></p>` : ""}
      </div>`,
    )
    .join("");
}

function renderFindingCard(entry: EvidencePack["findings"][number]): string {
  const f = entry.finding;
  const loc = f.location;
  const beforeImg = screenshotPath(f.findingId, "before");
  const afterImg = screenshotPath(f.findingId, "after");
  return `
  <article class="finding-card" id="${esc(f.findingId)}">
    <header class="finding-header">
      <h3>${esc(f.findingId)} — ${esc(f.title)}</h3>
      <p class="finding-meta">
        Rule <code>${esc(f.ruleId)}</code> &middot; Pattern <code>${esc(f.pattern)}</code> &middot;
        Severity <code>${esc(f.severity)}</code> &middot;
        Status: <span class="status-pill">${esc(statusCopy(f.status))}</span>
        ${f.requiresReview ? `<span class="review-flag">${esc(COPY.interfaceInterferenceLabel)}</span>` : ""}
      </p>
      <p class="finding-location"><code>${esc(loc.file)}:${esc(loc.startLine)}:${esc(loc.startColumn)}</code></p>
    </header>

    <section class="finding-evidence">
      <h4>Evidence</h4>
      <pre class="evidence-snippet"><code>${esc(f.evidence.sourceSnippet)}</code></pre>
      <p class="evidence-observed">Observed: <code>${esc(f.evidence.observed)}</code></p>
      ${f.evidence.warnings.length ? `<p class="warnings">Warnings: ${f.evidence.warnings.map((w) => `<code>${esc(w)}</code>`).join(", ")}</p>` : ""}
    </section>

    <section class="finding-signals">
      <h4>Signals</h4>
      ${renderSignalsTable(f.signals)}
    </section>

    <section class="finding-regulation">
      <h4>Regulatory basis</h4>
      ${renderRegulation(f.regulation)}
    </section>

    <section class="finding-proposals">
      <h4>Remediation proposals</h4>
      ${
        entry.proposals.length === 0
          ? `<p class="empty-note">No remediation proposals recorded.</p>`
          : entry.proposals.map((p) => renderProposal(p.proposal, p.result, p.verify)).join("")
      }
    </section>

    <section class="finding-screenshots">
      <h4>Screenshots</h4>
      <div class="screenshot-pair">
        <figure>
          <img src="${esc(beforeImg)}" alt="Before screenshot for ${esc(f.findingId)}"
               onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement('p'),{className:'screenshot-missing',textContent:'Screenshot not available.'}));" />
          <figcaption>Before</figcaption>
        </figure>
        <figure>
          <img src="${esc(afterImg)}" alt="After screenshot for ${esc(f.findingId)}"
               onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement('p'),{className:'screenshot-missing',textContent:'Screenshot not available.'}));" />
          <figcaption>After</figcaption>
        </figure>
      </div>
    </section>

    <section class="finding-approvals">
      <h4>Approvals</h4>
      ${renderApprovals(entry.approvals)}
    </section>
  </article>`;
}

function actorClass(actor: TraceEvent["actor"]): string {
  return `trace-actor-${actor}`;
}

function renderTraceTimeline(traceEvents: TraceEvent[] | undefined): string {
  if (!traceEvents || traceEvents.length === 0) {
    return `
    <section class="trace-timeline">
      <h2>Trace timeline</h2>
      <p class="empty-note">No trace events were provided with this report.</p>
    </section>`;
  }
  const rows = traceEvents
    .map((ev) => {
      const summary = esc(JSON.stringify(ev.payload));
      return `
        <li class="trace-event ${actorClass(ev.actor)}">
          <span class="trace-seq">#${esc(ev.seq)}</span>
          <span class="trace-ts"><code>${esc(ev.ts)}</code></span>
          <span class="trace-type"><code>${esc(ev.type)}</code></span>
          <span class="trace-actor">${esc(ev.actor)}</span>
          <span class="trace-payload"><code>${summary}</code></span>
        </li>`;
    })
    .join("");
  return `
    <section class="trace-timeline">
      <h2>Trace timeline</h2>
      <ol class="trace-list" role="log">${rows}</ol>
    </section>`;
}

function renderHashBlock(pack: EvidencePack): string {
  return `
  <section class="hash-block">
    <h2>Integrity</h2>
    <dl class="meta-grid">
      <div><dt>Evidence hash</dt><dd><code>${esc(pack.evidenceHash)}</code></dd></div>
      <div><dt>Trace head</dt><dd><code>${esc(pack.traceHead)}</code></dd></div>
    </dl>
    <p class="verify-instructions">
      To confirm this evidence pack has not been altered since it was generated, run
      <code>pramaan evidence verify &lt;path-to-this-directory&gt;</code> from a machine with the
      Pramaan CLI installed. That command recomputes the evidence hash and the trace hash chain
      from the files in this directory and reports whether they still match the values above.
    </p>
  </section>`;
}

function renderHonestLimits(): string {
  return `
  <section class="honest-limits">
    <h2>Honest limits</h2>
    <ul>
      <li>The evidence hash is unsigned. It detects edits made to this pack after it was generated, but it does not prove who generated the pack or vouch for their identity.</li>
      <li>Timestamps in this report (generated time, event times, verification times) come from the local clock of the machine that ran the audit, not from a trusted external time source.</li>
      <li>Detectors in this audit cover a fixed set of pattern families (basket sneaking, false urgency, interface interference, drip pricing, confirm shaming) defined for this fixture/config scope. Deceptive patterns outside that scope are not detected.</li>
      <li>This report is not a legal certification. It supports a self-audit; it does not establish legal compliance.</li>
    </ul>
  </section>`;
}

function renderDisclaimer(pack: EvidencePack): string {
  return `
  <footer class="disclaimer">
    <p>${esc(pack.disclaimer || DISCLAIMER)}</p>
  </footer>`;
}

const STYLE = `
  :root {
    color-scheme: light dark;
    --bg: #ffffff;
    --fg: #1a1a1a;
    --muted: #5b6270;
    --border: #d8dce2;
    --card-bg: #f7f8fa;
    --add-bg: #e6ffed;
    --add-fg: #22863a;
    --del-bg: #ffeef0;
    --del-fg: #b31d28;
    --pass: #1a7f37;
    --fail: #b31d28;
    --notrun: #9a6700;
    --actor-engine: #0969da;
    --actor-agent: #8250df;
    --actor-human: #bf3989;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117;
      --fg: #e6edf3;
      --muted: #9aa4b2;
      --border: #30363d;
      --card-bg: #161b22;
      --add-bg: #033a16;
      --add-fg: #56d364;
      --del-bg: #4c0e15;
      --del-fg: #ff7b72;
    }
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--fg);
    margin: 0;
    padding: 0 16px 48px;
    line-height: 1.5;
    font-size: 15px;
  }
  code, pre, .mono { font-family: ui-monospace, "SF Mono", Consolas, monospace; }
  main { max-width: 980px; margin: 0 auto; }
  h1, h2, h3, h4 { line-height: 1.25; }
  h1 { font-size: 1.6rem; margin: 24px 0 8px; }
  h2 { font-size: 1.3rem; margin-top: 32px; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
  h3 { font-size: 1.1rem; }
  h4 { font-size: 0.95rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.02em; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  th, td { text-align: left; border: 1px solid var(--border); padding: 4px 8px; font-size: 0.9rem; vertical-align: top; }
  .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 4px 16px; }
  .meta-grid dt { font-size: 0.75rem; color: var(--muted); text-transform: uppercase; }
  .meta-grid dd { margin: 0 0 6px; }
  .counts-summary { font-size: 1.4rem; }
  .count-before { color: var(--fail); }
  .count-after { color: var(--pass); }
  .finding-card {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--card-bg);
    padding: 16px;
    margin: 20px 0;
  }
  .status-pill { border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px; font-size: 0.8rem; }
  .review-flag { margin-left: 8px; color: var(--notrun); font-weight: 600; font-size: 0.8rem; }
  .evidence-snippet, .diff-view {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px;
    overflow-x: auto;
    white-space: pre;
  }
  .diff-view span { display: block; }
  .diff-add { background: var(--add-bg); color: var(--add-fg); }
  .diff-del { background: var(--del-bg); color: var(--del-fg); }
  .diff-hunk { color: var(--muted); }
  .unverified-note, .review-flag, .screenshot-missing { color: var(--notrun); font-size: 0.85rem; }
  .gates-banner { font-style: italic; color: var(--muted); font-size: 0.85rem; }
  .gate-pass { color: var(--pass); font-weight: 600; }
  .gate-fail { color: var(--fail); font-weight: 600; }
  .gate-not_run { color: var(--notrun); font-weight: 600; }
  .verdict { font-weight: 700; }
  .verdict-VERIFIED { color: var(--pass); }
  .verdict-FAILED { color: var(--fail); }
  .verdict-STATIC_VERIFIED { color: var(--notrun); }
  .screenshot-pair { display: flex; gap: 16px; flex-wrap: wrap; }
  .screenshot-pair img { max-width: 320px; border: 1px solid var(--border); border-radius: 6px; }
  .trace-list { list-style: none; padding: 0; margin: 0; max-height: 480px; overflow-y: auto; }
  .trace-event { display: flex; gap: 8px; padding: 4px 6px; border-bottom: 1px solid var(--border); font-size: 0.82rem; align-items: baseline; flex-wrap: wrap; }
  .trace-event .trace-payload { color: var(--muted); word-break: break-all; }
  .trace-actor-engine .trace-actor { color: var(--actor-engine); font-weight: 700; }
  .trace-actor-agent .trace-actor { color: var(--actor-agent); font-weight: 700; }
  .trace-actor-human .trace-actor { color: var(--actor-human); font-weight: 700; }
  .hash-block code { word-break: break-all; }
  .honest-limits ul { padding-left: 20px; }
  .disclaimer {
    margin-top: 40px;
    border-top: 3px solid var(--border);
    padding: 16px 0 32px;
    font-size: 0.9rem;
    color: var(--muted);
  }
  .empty-note { color: var(--muted); font-style: italic; }
  details.toc { margin: 16px 0; }
  details.toc summary { cursor: pointer; font-weight: 600; }
  details.toc ul { columns: 2; }
  @media (max-width: 600px) {
    details.toc ul { columns: 1; }
  }
`;

// Minimal, optional vanilla-JS enhancement: a "collapse all findings"
// toggle. The report is fully readable with JS disabled — this only
// adds a convenience class toggle and never generates markup itself.
const SCRIPT = `
  (function () {
    var toggle = document.getElementById('toggle-findings');
    if (!toggle) return;
    toggle.addEventListener('click', function () {
      document.querySelectorAll('.finding-card').forEach(function (card) {
        card.classList.toggle('collapsed');
      });
    });
  })();
`;

/**
 * Renders a complete, self-contained HTML evidence report for a pack.
 * Pure function: no I/O, no network, no external CDN references. Every
 * piece of scanned-source-derived text is HTML-escaped (I-07 / XSS).
 */
export function renderReportHtml(pack: EvidencePack, traceEvents?: TraceEvent[]): string {
  const findingCards = pack.findings.map(renderFindingCard).join("\n");
  const toc = pack.findings
    .map((e) => `<li><a href="#${esc(e.finding.findingId)}">${esc(e.finding.findingId)} — ${esc(e.finding.title)}</a></li>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Pramaan evidence report — ${esc(pack.audit.auditId)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  ${renderHeader(pack)}
  ${renderBeforeAfter(pack)}

  <section class="findings">
    <h2>Findings (${esc(pack.findings.length)})</h2>
    ${pack.findings.length > 1 ? `<details class="toc"><summary>Jump to finding</summary><ul>${toc}</ul></details>` : ""}
    ${pack.findings.length > 0 ? `<button id="toggle-findings" type="button">Expand / collapse all findings</button>` : ""}
    ${findingCards || `<p class="empty-note">No findings recorded in this pack.</p>`}
  </section>

  ${renderTraceTimeline(traceEvents)}
  ${renderHashBlock(pack)}
  ${renderHonestLimits()}
  ${renderDisclaimer(pack)}
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
