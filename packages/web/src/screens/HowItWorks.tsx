// How It Works — a single page covering two jobs:
//   1. The pipeline overview: Scan -> Investigate -> Fix -> Verify -> Evidence.
//   2. A deep section (#verification) on exactly how gates G1-G5 decide a
//      finding's outcome.
//
// Every claim on this page is grounded in the real engine, not invented:
//   - 5 detector types (PRM-001..005), packages/core/src/detectors/*.
//   - The agent is LLM-driven (Anthropic primary; Gemini/Groq fallback),
//     packages/agent/src/llm/*, proposing fixes via a 17-tool registry,
//     packages/agent/src/tools/registry.ts.
//   - The patch engine allows exactly 7 operation kinds, each gated by a
//     policy check + snapshot + write + rollback-on-failure,
//     packages/core/src/patch/{policy,ops,strategies}.ts.
//   - Verification runs 5 deterministic gates G1-G5,
//     packages/core/src/verify/gates.ts — only this module decides a
//     finding's verdict; agent text is never read as a verdict.
//   - The evidence pack is a SHA-256 hash-chained trace, independently
//     re-verifiable at /verify (S5Verify), packages/core/src/evidence/*.
import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { DISCLAIMER } from "../constants";
import AppShell from "../components/shell/AppShell.js";
import "../styles/landing.css";
import "../styles/howitworks.css";

const PIPELINE = [
  {
    title: "Scan",
    desc:
      "A deterministic detector engine walks the project's source and reads structural, CSS-cascade, and price-flow facts — never the agent's opinion. Five rule types run, each mapped to a dark-pattern category and a regulatory citation.",
    facts: [
      "PRM-001 Basket Sneaking",
      "PRM-002 False Urgency",
      "PRM-003 Interface Interference",
      "PRM-004 Drip Pricing",
      "PRM-005 Confirm Shaming",
    ],
  },
  {
    title: "Investigate",
    desc:
      "An LLM-driven agent (Anthropic primary, with Google Gemini and Groq as fallback providers) reads each finding's evidence and the surrounding code through a registry of 17 tools — reading files, inspecting the AST and CSS cascade, looking up the regulation, and proposing a strategy. The agent never decides a finding is fixed itself; that call belongs to a later, separate stage.",
    facts: ["17-tool registry", "Anthropic -> Gemini -> Groq fallback chain"],
  },
  {
    title: "Fix",
    desc:
      "The agent's strategy becomes a concrete patch proposal built from a fixed set of whitelisted operation kinds — nothing outside that set can be emitted. Every patch runs through a policy check before it touches disk, then a snapshot, then the write, with automatic rollback if anything fails partway through.",
    facts: [
      "7 whitelisted patch operations",
      "policy check -> snapshot -> write -> rollback on failure",
    ],
  },
  {
    title: "Verify",
    desc:
      "The same deterministic engine that found the issue re-scans the patched workspace. Five gates run in sequence, and a finding only moves to verified or failed based on what the gates report — the agent's own claims about its fix are not evidence.",
    facts: ["Gates G1 → G5", "detector.verify is the only tool that sets a verdict"],
  },
  {
    title: "Evidence",
    desc:
      "Every event in the run — scans, tool calls, proposals, patches, gate results — is written into a SHA-256 hash-chained trace. The audit exports as a tamper-evident JSON evidence pack that anyone can re-verify independently, without trusting this install, using the /verify page.",
    facts: ["SHA-256 hash chain", "Independently re-verifiable JSON evidence pack"],
  },
];

const GATES = [
  {
    id: "G1",
    title: "G1 — Detector clear",
    desc:
      "The detector engine re-runs the exact rule that originally flagged this finding against the patched code. If the pattern it was built to catch still matches, G1 fails and nothing downstream matters.",
  },
  {
    id: "G2",
    title: "G2 — Preservation",
    desc:
      "The patch is checked against a manifest of protected elements captured before the fix was applied, confirming the change didn't silently remove or break something it had no business touching.",
  },
  {
    id: "G3",
    title: "G3 — Build",
    desc:
      "The project's real build command runs against the patched workspace. A proposal that looks correct in isolation but breaks the build is not a fix.",
  },
  {
    id: "G4",
    title: "G4 — Runtime",
    desc:
      "Where runtime checks are enabled, the patched page is exercised and observed directly — not inferred from source — to confirm the dark pattern is actually gone in a running app.",
  },
  {
    id: "G5",
    title: "G5 — No regression",
    desc:
      "A full detector sweep of every rule (not just the one that was being fixed) runs again, comparing against the pre-patch baseline, to confirm the fix didn't introduce a new finding elsewhere.",
  },
];

export default function HowItWorks(): JSX.Element {
  const location = useLocation();

  useEffect(() => {
    if (location.hash === "#verification") {
      const el = document.getElementById("verification");
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [location.hash]);

  return (
    <div className="hiw-page">
      <AppShell />

      <main className="hiw-container">
        <section className="hiw-hero">
          <p className="hiw-eyebrow">How it works</p>
          <h1 className="hiw-headline">
            Every verdict is <em>earned</em>, not asserted.
          </h1>
          <p className="hiw-lede">
            PRAMAAN scans a frontend project for dark patterns, lets an LLM agent propose fixes,
            and then re-checks every fix with the same deterministic engine that found the
            problem in the first place. The agent proposes; it never gets to grade its own work.
          </p>
        </section>

        <section className="hiw-section" aria-labelledby="hiw-pipeline-heading">
          <p className="hiw-section-label">The pipeline</p>
          <h2 id="hiw-pipeline-heading" className="hiw-section-title">
            Scan &rarr; Investigate &rarr; Fix &rarr; Verify &rarr; Evidence
          </h2>
          <p className="hiw-section-dek">
            Five stages, each with a narrow job. Detection and verification both run on the same
            deterministic engine; only the middle stage — investigating and proposing a fix — is
            where the LLM agent operates.
          </p>

          <ol className="hiw-pipeline">
            {PIPELINE.map((phase, i) => (
              <li className="hiw-phase" key={phase.title}>
                <span className="hiw-phase-index" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="hiw-phase-body">
                  <h3 className="hiw-phase-title">{phase.title}</h3>
                  <p className="hiw-phase-desc">{phase.desc}</p>
                  <ul className="hiw-phase-facts">
                    {phase.facts.map((fact) => (
                      <li key={fact}>{fact}</li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="hiw-section" id="verification" aria-labelledby="hiw-verify-heading">
          <p className="hiw-section-label">The trust claim</p>
          <h2 id="hiw-verify-heading" className="hiw-section-title">
            How verification actually works
          </h2>
          <p className="hiw-section-dek">
            This is the core guarantee the rest of the product rests on: a finding's status can
            only change because a deterministic gate said so.
          </p>

          <div className="hiw-verify-banner">
            <p>
              <strong>The LLM agent cannot mark a finding verified.</strong> It can propose a fix,
              apply it, and ask the engine to check its work — but the tool that decides pass or
              fail, <code>detector.verify</code>, runs five independent gates over the actual code
              and build output. Agent-written summaries are never read as evidence. If the gates
              don&rsquo;t pass, the finding stays open or gets escalated for human review — no
              matter what the agent says about itself.
            </p>
          </div>

          <ol className="hiw-stepper">
            {GATES.map((gate) => (
              <li className="hiw-step" key={gate.id}>
                <span className="hiw-step-rail">
                  <span className="hiw-step-badge hiw-step-badge--pass">{gate.id}</span>
                  <span className="hiw-step-line" aria-hidden="true" />
                </span>
                <div className="hiw-step-body">
                  <h3 className="hiw-step-title">{gate.title}</h3>
                  <p className="hiw-step-desc">{gate.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="hiw-section" aria-labelledby="hiw-evidence-heading">
          <p className="hiw-section-label">After verification</p>
          <h2 id="hiw-evidence-heading" className="hiw-section-title">
            A pack anyone can re-check
          </h2>
          <p className="hiw-section-dek">
            Every scan, tool call, proposal, patch, and gate result in a run is written into a
            SHA-256 hash-chained trace. The finished audit exports as a JSON evidence pack with
            that chain intact, so tampering after the fact is detectable rather than assumed
            away. The <Link to="/verify">/verify</Link> page runs that same check independently —
            it doesn&rsquo;t trust this install, it recomputes the chain from the pack itself.
          </p>
        </section>

        <div className="hiw-actions">
          <Link to="/audit" className="lp-pill lp-pill--primary">
            Start an audit
          </Link>
          <Link to="/verify" className="lp-pill">
            Verify an evidence pack
          </Link>
        </div>

        <p className="hiw-disclaimer">{DISCLAIMER}</p>
      </main>
    </div>
  );
}
