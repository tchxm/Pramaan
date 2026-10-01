# PRAMAAN

A deceptive-interface remediation and evidence engine for React/TypeScript frontends.

PRAMAAN scans a frontend project for four deterministic families of deceptive UI
patterns (basket sneaking, false urgency, interface interference, drip pricing) plus
one semantic candidate pattern (confirm shaming) that always requires human review.
It captures structured evidence for every finding, maps findings to Indian
regulatory guidance, lets one bounded LLM agent investigate and propose fixes, applies
only whitelisted patch operations to an isolated workspace copy, re-verifies with the
same deterministic engine plus runtime browser checks, and emits a tamper-evident
evidence pack.

> Pramaan identifies technical patterns associated with deceptive interfaces, maps
> them to relevant regulatory guidance, and produces evidence supporting a
> self-audit. It does not provide legal certification.

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
`detector.verify` (in `core`) may produce a `VERIFIED`/`FAILED` verdict — the agent
proposes, the deterministic engine disposes.

## Quickstart

```bash
npm install
npm run build
npx playwright install chromium   # needed for runtime verification (G4)

# scan a fixture without an LLM
npm run pramaan -- scan ./fixtures/f06-mitti-mart

# full audit with a live LLM (requires LLM_API_KEY)
LLM_API_KEY=... npm run pramaan -- audit ./fixtures/f06-mitti-mart

# start the server + web app for the interactive demo
npm run demo
```

## Environment variables

See `PRAMAAN_MASTER_SPEC.md` Section 6.1 for the full list (`LLM_API_KEY`,
`PRAMAAN_MODEL`, `PRAMAAN_RUNTIME`, `PRAMAAN_MAX_TOOL_CALLS`, `PORT`, etc.).

## Limits

- The evidence hash is unsigned: it detects edits, it does not prove authorship.
- Detectors cover five specified pattern families only; absence of a finding is not
  a claim that a project has no dark patterns.
- Static analysis has documented blind spots (runtime-only style mutation, CSS-in-JS,
  Tailwind utility classes, `@media`/`@supports` contents); the runtime gate (G4) is
  the backstop, not a replacement, for what static analysis cannot see.
- PRAMAAN does not provide legal certification. See the disclaimer above.

## Source of truth

`PRAMAAN_MASTER_SPEC.md` is the authoritative behavioral specification. Where any
other document disagrees with it on product behavior, the spec wins.
