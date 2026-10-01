# PRAMAAN

**A deceptive-interface remediation and evidence engine for React/TypeScript frontends.**

Point PRAMAAN at a frontend project and it scans for deceptive UI ("dark")
patterns, lets a bounded LLM agent propose and apply a fix, re-verifies the
fix with the same deterministic engine plus a real browser, and emits a
tamper-evident evidence pack you can hand to a regulator, an auditor, or
anyone who wants to check your work.

The deterministic engine — not the LLM — decides every verdict. The agent
proposes; `detector.verify` disposes.

> Pramaan identifies technical patterns associated with deceptive interfaces,
> maps them to relevant regulatory guidance, and produces evidence supporting
> a self-audit. It does not provide legal certification.

## What it detects

Five pattern families, four of them fully deterministic (no LLM in the
detection path):

| Pattern | Family | Example |
|---|---|---|
| Basket sneaking | deterministic | an item added to cart without explicit user action |
| False urgency | deterministic | a countdown timer with no real deadline behind it |
| Interface interference | deterministic | a "reject all" control styled to be harder to see/click than "accept" |
| Drip pricing | deterministic | a mandatory fee disclosed only at the last checkout step |
| Confirm-shaming | semantic candidate — always flagged for human review, never auto-verdicted |

Each finding carries structured evidence (source location, DOM/CSS capture,
computed styles) and a mapped reference to relevant Indian regulatory
guidance (CCPA guidelines, Consumer Protection Act provisions) — paraphrased,
never asserting legal certification.

## How a fix gets verified

1. **Scan** — the deterministic engine finds candidate violations in source.
2. **Investigate** — a tool-calling LLM agent (bounded by a tool-call and
   token budget) inspects the finding and picks a remediation strategy from a
   fixed, whitelisted set — it cannot invent new patch operations.
3. **Patch** — the patch is applied to an isolated copy of the workspace,
   never the original.
4. **Verify (G1–G5)** — the same deterministic detectors re-run, plus a real
   headless-browser runtime check, confirming the violation is actually gone
   and nothing else broke.
5. **Evidence** — a SHA-256 hash-chained, tamper-evident evidence pack is
   written; `/verify` (web) or `pramaan verify` (CLI) will catch any
   after-the-fact edit to it.

If the agent can't produce a passing fix, or no LLM is configured, PRAMAAN
says so honestly ("Agent unavailable") rather than fabricating a result —
deterministic detection still runs either way.

## Architecture

```text
┌──────────────────────────────────────────────────────────────────────┐
│ PRESENTATION   packages/web (React)      packages/cli (Node)          │
├──────────────────────────────────────────────────────────────────────┤
│ SERVICE        packages/server (Fastify: REST + Server-Sent Events)   │
├──────────────────────────────────────────────────────────────────────┤
│ AGENT          packages/agent  (LLM client, tool registry, loop,      │
│                                 budget, trace, approval handshake)    │
├──────────────────────────────────────────────────────────────────────┤
│ ENGINE (truth) packages/core                                          │
│   parser · style/cascade · detectors · price-flow · regulation        │
│   patch planner + policy · verify gates · runtime probes · evidence   │
└──────────────────────────────────────────────────────────────────────┘
```

Dependency direction is strictly downward. `core` never imports `agent`. Only
`detector.verify` (in `core`) may produce a `VERIFIED`/`FAILED` verdict.

The LLM layer supports multiple providers with automatic fallback
(Anthropic → Gemini → Groq → OpenRouter → Cloudflare Workers AI, configurable
via `PRAMAAN_LLM_PROVIDERS`) so a demo isn't blocked by one provider's quota.

## Quickstart

```bash
npm install
npm run build
npx playwright install chromium   # needed for runtime verification (G4)

# scan a fixture without an LLM — deterministic detection only
npm run pramaan -- scan ./fixtures/f06-mitti-mart

# full audit with a live LLM agent (needs at least one provider key — see
# .env.example)
npm run pramaan -- audit ./fixtures/f06-mitti-mart

# start the server + web app for the interactive demo
npm run demo
```

## Testing

```bash
npm test        # unit + integration (vitest)
npm run e2e      # Playwright end-to-end suite against a real server + browser
npm run typecheck
```

## Environment variables

Copy `.env.example` to `.env` at the repo root. See `docs/SPEC.md` Section
6.1 for the full list (`LLM_API_KEY`/`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
`GROQ_API_KEY`, `OPENROUTER_API_KEY`, `CLOUDFLARE_*`, `PRAMAAN_LLM_PROVIDERS`,
`PRAMAAN_RUNTIME`, `PORT`, etc.). `.env` is gitignored and never committed.

## Limits

- The evidence hash is unsigned: it detects edits, it does not prove
  authorship.
- Detectors cover five specified pattern families only; absence of a finding
  is not a claim that a project has no dark patterns.
- Static analysis has documented blind spots (runtime-only style mutation,
  CSS-in-JS, Tailwind utility classes, `@media`/`@supports` contents); the
  runtime gate (G4) is the backstop, not a replacement, for what static
  analysis cannot see.
- PRAMAAN does not provide legal certification. See the disclaimer above.

## Source of truth

`docs/SPEC.md` is the authoritative behavioral specification for this build.
Where any other document disagrees with it on product behavior, the spec
wins.
