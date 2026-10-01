// Documentation — spec section 30. "Documentation" was a dead in-page
// anchor before this existed. Every fact on this page is reused from the
// real spec/README, not invented: 5 detector rule IDs, 7 whitelisted patch
// operations, G1-G5 gate semantics, and the architecture layering are the
// same facts HowItWorks.tsx and the engine itself already assert.
import { Link } from "react-router-dom";
import { DISCLAIMER } from "../constants";
import AppShell from "../components/shell/AppShell.js";
import "../styles/landing.css";
import "../styles/howitworks.css";
import "../styles/docs.css";

const SECTIONS = [
  { id: "overview", label: "01 Overview" },
  { id: "architecture", label: "02 Architecture" },
  { id: "detectors", label: "03 Detector rules" },
  { id: "agent", label: "04 Agent authority" },
  { id: "patch", label: "05 Patch policy" },
  { id: "verify", label: "06 Verification gates" },
  { id: "evidence", label: "07 Evidence format" },
  { id: "cli", label: "08 CLI" },
  { id: "demo", label: "09 Demo" },
  { id: "limits", label: "10 Limitations" },
];

const RULES = [
  { id: "PRM-001", name: "Basket sneaking", desc: "An add-on is pre-selected or re-added to the cart without an explicit, equally-weighted opt-in." },
  { id: "PRM-002", name: "False urgency", desc: "A countdown or scarcity claim is rendered without a real, verifiable deadline backing it." },
  { id: "PRM-003", name: "Interface interference", desc: "A decline/no-thanks path is visually suppressed relative to the accept path via the CSS cascade." },
  { id: "PRM-004", name: "Drip pricing", desc: "A mandatory fee is disclosed only at the final checkout step rather than up front." },
  { id: "PRM-005", name: "Confirm shaming", desc: "A decline action is labeled with guilt-inducing language; always routed to human review, never auto-fixed." },
];

const PATCH_OPS = [
  "SET_INITIAL_STATE_LITERAL",
  "WIRE_CONTROLLED_CHECKBOX",
  "SET_CSS_DECLARATION",
  "REMOVE_CSS_IMPORTANT",
  "REMOVE_JSX_ELEMENT",
  "INSERT_FEE_DISCLOSURE",
  "REPLACE_JSX_TEXT",
];

const GATES = [
  { id: "G1", name: "Detector clear", desc: "Re-runs the full scan on the patched workspace; the finding's rule must no longer match." },
  { id: "G2", name: "Preservation", desc: "Recomputes the protected-element manifest; nothing outside the approved change may have moved or vanished." },
  { id: "G3", name: "Build", desc: "Runs the real build command (and tsc --noEmit when applicable) — must exit 0." },
  { id: "G4", name: "Runtime", desc: "Serves the built output and runs a derived browser probe in headless Chromium. Disabled when PRAMAAN_RUNTIME=off." },
  { id: "G5", name: "No regression", desc: "Compares the post-patch scan against the pre-patch scan — no new findings, parse errors, or warnings in touched files." },
];

export default function DocsPage(): JSX.Element {
  return (
    <div className="hiw-page docs-page">
      <AppShell />

      <div className="docs-layout">
        <nav className="docs-toc" aria-label="Documentation sections">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              {s.label}
            </a>
          ))}
        </nav>

        <main className="hiw-container docs-main">
          <section className="hiw-hero">
            <p className="hiw-eyebrow">Documentation</p>
            <h1 className="hiw-headline">PRAMAAN documentation</h1>
            <p className="hiw-lede">
              This page is real, not placeholder — every fact below is reused from the engine's own
              specification. Where this page and the engine ever disagree, the engine is right.
            </p>
          </section>

          <section id="overview" className="hiw-section">
            <p className="hiw-section-label">01</p>
            <h2 className="hiw-section-title">Overview</h2>
            <p className="hiw-section-dek">
              PRAMAAN scans a frontend project for five deterministic families of deceptive UI
              patterns, captures structured evidence for every finding, maps findings to Indian
              regulatory guidance, lets one bounded LLM agent investigate and propose fixes, applies
              only whitelisted patch operations to an isolated workspace copy, re-verifies with the
              same deterministic engine plus runtime browser checks, and emits a tamper-evident
              evidence pack.
            </p>
          </section>

          <section id="architecture" className="hiw-section">
            <p className="hiw-section-label">02</p>
            <h2 className="hiw-section-title">Architecture</h2>
            <pre className="docs-code">{`┌──────────────────────────────────────────────────────────────────┐
│ PRESENTATION   packages/web (React)      packages/cli (Node)      │
├──────────────────────────────────────────────────────────────────┤
│ SERVICE        packages/server (Fastify: REST + Server-Sent Events)│
├──────────────────────────────────────────────────────────────────┤
│ AGENT          packages/agent  (LLM client, tool registry, loop,  │
│                                 budget, trace, approval handshake) │
├──────────────────────────────────────────────────────────────────┤
│ ENGINE (truth) packages/core                                      │
│   parser · style/cascade · detectors · price-flow · regulation    │
│   patch planner + policy · verify gates · runtime probes · evidence│
└──────────────────────────────────────────────────────────────────┘`}</pre>
            <p className="hiw-section-dek">
              Dependency direction is strictly downward. <code>core</code> never imports{" "}
              <code>agent</code>. Only <code>detector.verify</code> in <code>core</code> may produce
              a VERIFIED/FAILED verdict.
            </p>
          </section>

          <section id="detectors" className="hiw-section">
            <p className="hiw-section-label">03</p>
            <h2 className="hiw-section-title">Detector rules</h2>
            <p className="hiw-section-dek">
              Five rule types, each mapped to a dark-pattern category and a regulatory citation. Four
              run fully automatically; PRM-005 always routes to human review.
            </p>
            <div className="docs-rule-list">
              {RULES.map((r) => (
                <div key={r.id} className="docs-rule">
                  <span className="docs-rule__id">{r.id}</span>
                  <div>
                    <strong>{r.name}</strong>
                    <p>{r.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section id="agent" className="hiw-section">
            <p className="hiw-section-label">04</p>
            <h2 className="hiw-section-title">Agent authority</h2>
            <p className="hiw-section-dek">
              An LLM-driven agent (Anthropic primary, Gemini and Groq as fallback providers) reads
              each finding's evidence and surrounding code through a tool registry — reading files,
              inspecting the AST and CSS cascade, looking up the regulation, proposing a strategy.{" "}
              <strong>The agent never decides a finding is fixed.</strong> That call belongs
              exclusively to the deterministic verification gates below.
            </p>
          </section>

          <section id="patch" className="hiw-section">
            <p className="hiw-section-label">05</p>
            <h2 className="hiw-section-title">Patch policy</h2>
            <p className="hiw-section-dek">
              The agent's strategy becomes a concrete patch proposal built from exactly seven
              whitelisted operation kinds — nothing outside this set can be emitted. Every patch runs
              through a policy check before it touches disk, then a snapshot, then the write, with
              automatic rollback if anything fails partway through.
            </p>
            <ul className="docs-chip-list">
              {PATCH_OPS.map((op) => (
                <li key={op} className="docs-chip">
                  {op}
                </li>
              ))}
            </ul>
          </section>

          <section id="verify" className="hiw-section">
            <p className="hiw-section-label">06</p>
            <h2 className="hiw-section-title">Verification gates</h2>
            <p className="hiw-section-dek">
              The same deterministic engine that found the issue re-scans the patched workspace. A
              finding only moves to VERIFIED or FAILED based on what these gates report — the agent's
              own claims about its fix are not evidence.
            </p>
            <div className="docs-gate-list">
              {GATES.map((g) => (
                <div key={g.id} className="docs-gate">
                  <span className="docs-gate__id">{g.id}</span>
                  <div>
                    <strong>{g.name}</strong>
                    <p>{g.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="hiw-section-dek">
              <strong>VERIFIED</strong> means G1–G5 all passed. <strong>STATIC_VERIFIED</strong> means
              G1, G2, G3, G5 passed and G4 was not run because <code>PRAMAAN_RUNTIME=off</code> — every
              surface labels this "static only," never VERIFIED.
            </p>
          </section>

          <section id="evidence" className="hiw-section">
            <p className="hiw-section-label">07</p>
            <h2 className="hiw-section-title">Evidence format</h2>
            <p className="hiw-section-dek">
              Every action — scan, agent investigation, patch, each gate result, human approval — is
              written to a hash-chained trace. The evidence pack bundles that trace with the final
              audit record under a SHA-256 hash. The <Link to="/verify">/verify</Link> page
              independently recomputes every check against a pack you drop into it — it does not trust
              the pack's own claims about itself.
            </p>
          </section>

          <section id="cli" className="hiw-section">
            <p className="hiw-section-label">08</p>
            <h2 className="hiw-section-title">CLI</h2>
            <pre className="docs-code">{`npm install
npm run build
npx playwright install chromium   # needed for runtime verification (G4)

# scan a fixture without an LLM
npm run pramaan -- scan ./fixtures/f06-mitti-mart

# full audit with a live LLM (requires LLM_API_KEY)
LLM_API_KEY=... npm run pramaan -- audit ./fixtures/f06-mitti-mart

# start the server + web app for the interactive demo
npm run demo`}</pre>
          </section>

          <section id="demo" className="hiw-section">
            <p className="hiw-section-label">09</p>
            <h2 className="hiw-section-title">Demo</h2>
            <p className="hiw-section-dek">
              <code>npm run demo</code> builds the core engine and server, starts the API, waits for
              it to report healthy, then starts the web app. The fastest path through the product is{" "}
              <Link to="/demo">Watch the demo</Link>: a saved Mitti Mart walkthrough with real findings,
              a patch, and engine results. It works without the live API. Its live-run link starts
              a new fixture audit. “Run guided demo audit” uses a scripted sequence through the real
              engine: one complete fix, one proposal-only stop, and two stops without proposals.
              Live-agent mode remains a separate choice.
            </p>
          </section>

          <section id="limits" className="hiw-section">
            <p className="hiw-section-label">10</p>
            <h2 className="hiw-section-title">Limitations</h2>
            <ul className="docs-limits">
              <li>The evidence hash is unsigned: it detects edits, it does not prove authorship.</li>
              <li>
                Detectors cover five specified pattern families only; absence of a finding is not a
                claim that a project has no dark patterns.
              </li>
              <li>
                Static analysis has documented blind spots (runtime-only style mutation, CSS-in-JS,
                Tailwind utility classes, @media/@supports contents) — the runtime gate (G4) is the
                backstop, not a replacement, for what static analysis cannot see.
              </li>
              <li>PRAMAAN does not provide legal certification.</li>
            </ul>
            <p className="hiw-disclaimer">{DISCLAIMER}</p>
          </section>
        </main>
      </div>
    </div>
  );
}
