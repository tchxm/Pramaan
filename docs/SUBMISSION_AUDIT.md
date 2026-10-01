# PRAMAAN — observed submission audit

Audit date: 1 October 2026. Category: **Developer & AI**, explicitly confirmed by the creator. Baseline commit: `eee3a09`; this audit includes the subsequent working-tree UI changes and the fixes below. No deployment, merge, or source-project writeback was performed.

**SAFE TO FREEZE REPO? NO.** A real single-finding agent repair is proven, and the guided demo works. The four-finding live scenario is still unreliable under the configured providers' quotas. The finished two-minute MP4 is ready locally; video upload, public demo destination and pitch deck remain pending. There is no basis to claim the full submission is complete.

## Verification results

| Check | Observed result |
|---|---|
| `npm run build` | Pass across all workspaces. Web has a non-fatal bundle-size warning. |
| `npm test` | 29 suites, 154 tests pass after the last safety fix. |
| `npm run fixtures:build` | 13/13 fixture builds pass. |
| `npm run e2e -- --workers=1` | 53/53 pass against an unconfigured API, covering the explicitly scripted guided run and unavailable-agent behavior. This is not the live-agent proof. |
| `npm run demo` | Actual CLI/server/web startup observed on temporary ports 8792/5174; health and web readiness checked; stopped after the check. |
| Live agent, single finding | **PROVEN:** `PRM-2026-000115`, Groq `openai/gpt-oss-120b`, `mode: live`, 1 finding → 0 unresolved, one applied attempt, real G1–G5 pass. |
| Evidence for that live run | Pack hash, engine trace chain and trace-head equality all pass. Captured pack, trace and raw browser video retained locally. |
| Full four-finding live audit | **PARTIALLY PROVEN:** real calls, proposal, application and verification exercised; no successful complete four-finding outcome. Provider exhaustion ended the run. |
| Guided four-finding audit | 4 → 3 unresolved; one VERIFIED fix, one proposal-only stop, two review-only stops; real engine execution with scripted tool decisions, prominently labelled. |
| Saved `/demo` example | Regenerated from the actual engine: four findings, checkbox VERIFIED, three remaining. It explicitly represents no live agent session. |
| Secrets | 373 worktree files and 479 Git-history blobs scanned: no configured-key or selected provider-key-pattern matches. `.env` and `.env.local` ignored. This is a scoped scan, not an exhaustive credential guarantee. |

## Agent workflow: actual responsibility and evidence

| Stage | Implementation | Input → output | Decision owner / UI evidence |
|---|---|---|---|
| UNDERSTAND | `core/src/parser/project.ts: buildProjectModel`; `core/src/detectors/index.ts: runDetectorsWithWarnings`; `agent/src/runAudit.ts` | Config + isolated source → parsed model, source locations, evidence, fingerprints, regulatory context | Deterministic engine; `scan.completed`, finding list, Code and evidence panels. Four static rule families; confirm-shaming candidates require semantic inspection. |
| REASON | `agent/src/loop.ts: runAgentLoop`; `llm/*`; `prompts.ts` | Finding summary + prior tool outputs → real model reply/tool calls | LLM; `agent.reason` records actual serving provider/model. Text alone cannot verify a finding. |
| PLAN | `tools/patchTools.ts: patchProposeHandler`; `core/src/patch/strategies.ts` | Model-selected whitelisted strategy → engine-generated bounded operations | Agent selects the strategy; engine constructs the edit. `agent.plan` and proposal panel expose the proposal. No separate autonomous planning service is claimed. |
| USE TOOLS | `tools/registry.ts: dispatchToolCall`; `fileTools.ts`, `inspectTools.ts`, `detectorTools.ts` | Validated inputs → source/AST/cascade/price-flow/regulation results | Agent selects tools; typed engine handlers execute them. `agent.tool_call` + `tool.result` feed the trace. Source remains untrusted data. |
| ACT | `patchTools.ts: patchApplyHandler`; `core/src/patch/apply.ts: applyPatch`; `policy.ts: checkPolicy` | Concrete proposal → policy-checked isolated edit or transactional rollback | Engine; `patch.applied` includes real `applied` and policy failures. Changed code does not itself imply success. |
| DELIVER / VERIFY | `verifyTools.ts: detectorVerifyHandler`; `core/src/verify/gates.ts: verifyFinding` | Patched workspace + original baseline → G1–G5 and engine verdict | Engine + real browser. G4 disabled gives STATIC_VERIFIED, never VERIFIED. Gate UI and outcome read actual events. |
| EVIDENCE | `verifyTools.ts: evidenceGenerateHandler`; `core/src/evidence/pack.ts`; report bundle | Audit, proposals, gate results, file hashes + trace prefix → pack, report, matching `trace.jsonl` | Deterministic hashing; `/verify` checks pack hash and optional trace chain/head. Hashes are unsigned and do not establish authorship. |

## Mandatory live runs

### Successful single-finding test and recording

The earlier harness run `LIVE-f01-basket-simple-1790864516480` exercised `source.read → patch.propose → patch.apply → detector.verify` and returned VERIFIED. After the evidence/provenance fixes, the fresh **API and UI** run `PRM-2026-000115` independently completed the repair, including all five gates and a verified evidence chain. Its pack names the actual Groq model rather than a provider inferred from whichever key happens to exist.

Recording inputs: `fixtures/f01-basket-simple`; the checkbox initially uses `useState(true)`. The actual edit changes it to `false`. This fixture has ₹799 coffee and ₹49 optional protection, so its default total changes ₹848 → ₹799. **Do not attach the separate Mitti Mart ₹887 → ₹838 totals to this live audit.**

Local artifacts, excluded from Git:

- `packages/web/qa/submission-audit/live-footage/record.json`
- `packages/web/qa/submission-audit/live-footage/evidence-pack.json`
- `packages/web/qa/submission-audit/live-footage/trace.jsonl`
- `packages/web/qa/submission-audit/live-footage/live-audit-raw.webm`
- Workspace, diff and outcome PNGs in that same folder.

### Four-finding live test

The original provider order could not reach a working model: OpenRouter and Cloudflare quotas were exhausted, then Anthropic rejected the request for insufficient credits. Gemini and Groq subsequently passed actual small function-call probes. A probe did not guarantee sufficient quota for an audit.

`LIVE-f06-mitti-mart-1790864828212` used Groq for real investigation and tool calls. The timer strategy was proposed twice; its first apply failed parse validation and rolled back. It made no successful verification. A valid failure evidence bundle was generated when the diagnostic budget expired. That run exposed the timer-target and status-reporting issues fixed below.

`LIVE-f06-mitti-mart-1790865753019` applied the corrected timer target and invoked real verification. G1, G3 and G4 passed; G2/G5 exposed unstable sibling fingerprints. Groq then exhausted retries on TPM limits; Gemini/OpenRouter/Cloudflare were also unavailable, and Anthropic lacked credits. The final audit correctly reports `error`, with four findings unresolved and no generated completed evidence pack.

| Finding | Actual latest live work | Applied attempts | Latest observed result |
|---|---|---:|---|
| PRM-002 false urgency | `patch.propose → patch.apply → detector.verify` | 1 | Applied; FAILED verification due G2/G5 identity changes; returned open for retry. |
| PRM-001 basket sneaking | Detected; model did not reach remediation | 0 | Open, no proposal/verification in that run. |
| PRM-003 interface interference | Detected; model did not reach remediation | 0 | Open, no proposal/verification in that run. |
| PRM-004 drip pricing | Detected; model did not reach remediation | 0 | Open, no proposal/verification in that run. |

After this run, timer sibling identities and price protection were repaired. A regression test now runs the real f06 timer proposal through **all five gates**, returning VERIFIED while preserving prices and controls. This proves the corrected engine strategy; **the entire live f06 model session has not passed since that final fix**. No provider was substituted to hide a bad reasoning outcome.

Harness limit: four minutes and 60 tool calls, three attempts per finding. Production defaults remain fifteen minutes/60 calls. This audit does not certify fifteen-minute full-scenario completion.

## Provider resilience

Local ignored `.env` now orders `groq,gemini,openrouter,cloudflare,anthropic`; keys were preserved. Groq is confirmed to serve real tool calls and the successful live repair, but its free-tier 8,000 tokens/minute limit interrupted f06. Gemini's free daily quota, OpenRouter's free daily quota and Cloudflare's daily neuron quota were exhausted. Anthropic reported insufficient credits.

429 retry hints now receive bounded waits (up to 30 seconds, two retries), with existing default delays when no usable hint is supplied. Malformed completion shapes and missing-model responses are classified as infrastructure errors. Authentication/bad-input responses do not trigger indiscriminate fallback. Actual 429/fallback behavior was observed; timeout, 5xx, malformed and Retry-After edge cases are tested with fixtures, not claimed as live injected outages.

## P0/P1 repairs made during this audit

- Vitest now collects unit/integration `*.test.ts` only; Playwright `*.spec.ts` and generated outputs are separate. The baseline otherwise failed despite passing unit tests.
- Report bundles now contain the real engine trace prefix committed by the pack. Outcome shows the pack's trace head, rather than the separately re-chained server stream tail.
- Provider/model provenance comes from the actual response. Error redaction removes full configured-key values.
- Unavailable-agent audits return `error`; a request crossing the clock limit no longer masks provider failure as budget exhaustion. Budget messages reflect configured limits. Applied attempts are recorded on findings.
- Timer removal finds the smallest actual countdown display, rejects protected descendants, preserves sibling identities with a non-rendering fragment, and leaves other source intact. Price protection classifies price-displaying elements rather than all their ancestors. Existing gates remain in force.
- API and CLI writeback now refuse incomplete audits or any applied patch whose finding has not verified. The UI disables that action for unchecked patches. A negative API test confirms original source remains untouched.
- Incorrect Rule 4(15)/2020 dark-pattern-annex attribution was replaced with the 2023 CCPA framework and the dated 2025 self-audit advisory. Gazette verification remains explicitly false.

## Judge journey and visual QA

Within approximately 60–90 seconds, a judge can enter `/`, use **Watch the demo**, see the ₹799→₹887 shopper problem and source-backed checkbox comparison, then open the guided run and its actual outcomes/evidence. This walkthrough establishes the problem and engine behavior; the live-agent proof is the separately recorded single-finding run.

Robot-position screenshot QA: **PASS on the current UI**. Captured and visually inspected investigate/verify/proof frames at 1440×900, 1366×768, 1024×768 and 768×1024, including reverse scroll. CRT labels match INVESTIGATING, G1→G5 and RECORDED; head/CRT is prominent, torso cropped, copy remains unobstructed, tablet robot sits below copy. Mobile uses its static fallback. Hero, entry, saved-demo steps, guided findings, checkout and outcome were captured at those sizes plus 390×844 with no horizontal overflow or page exceptions.

Evidence scripts: `qa/robot-framing/aligned-beats.mjs`, `qa/demo-capture.mjs`, `qa/mixed-demo-capture.mjs`. Speech lifecycle checks pass with controlled SpeechSynthesis callbacks; actual audible hardware output and real audio-frequency response were not tested. Reduced-motion/static fallback, back/forward, replay intro and ordinary reload have automated coverage. Browser-native hard reload cannot reliably be distinguished from normal reload; the explicitly accepted Replay intro behavior is retained.

The V3 prompt file is absent from the current checkout following earlier cleanup. Existing framing acceptance and screenshots were rechecked; this is not a claim that its full Sections 53–73 text was re-read from an available file. Sphere topology remains the existing 560 nodes/152 links, not a claim of complete V3 topology implementation.

## Bharat relevance and limits

Rupee-based checkout examples demonstrate a concrete Indian consumer problem. CCPA's 2023 framework identifies thirteen patterns; PRAMAAN covers four deterministic source rule families plus a semantic confirm-shaming path, not all thirteen. The self-audit context comes from the [PIB advisory announcement](https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=2134765&lang=2&reg=48), with its issuance date confirmed in the [July 2025 government response](https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=2146813&lang=2&reg=3). The framework is listed by the [Department of Consumer Affairs](https://consumeraffairs.gov.in/pages/consumer-protection-acts).

Measured shopper benefit in the saved illustration is removal of an automatic ₹49 add-on, while preserving the option to buy it. No measured population-level impact, merchant adoption, multilingual audit capability or legal certification is established.

Local runtime verification is real. The checkout preview is a limited illustration, not arbitrary project execution. Packs currently have no runtime screenshot artifacts and version metadata includes unknown fields. The local server exposes filesystem-oriented functionality and must not be published directly as a public multi-tenant service without additional isolation/access controls.

## Submission assets

| Deliverable | Status | Evidence / remaining action |
|---|---|---|
| Name | READY | PRAMAAN |
| Team | READY | README: DrCode — Mohammed Afnan, Shivam Kumar; confirm spellings before submission. |
| Category | READY | Developer & AI, creator confirmed. |
| Problem / solution | READY | README and shopper demo. |
| Agent workflow / architecture | READY | Code-backed mapping above and README. |
| Stack | READY | TypeScript, React, Fastify, Babel/PostCSS, Playwright, Three.js, provider adapters. |
| Repository | NEEDS UPDATE | Local remote is `https://github.com/tchxm/Pramaan.git`; final changes remain uncommitted/unpushed. Public clone access was not tested. |
| Working demo | NEEDS UPDATE | Local app verified; no verified public deployment URL. Local judge demo can use the verified startup path. |
| Two-minute video | NEEDS UPDATE | Finished narrated 120-second 1080p MP4 exported and decoded successfully; captions and key frames reviewed. Upload URL still missing. |
| Five-slide deck | MISSING | No submitted deck located in the repository. |

## Evidence-based scorecard

| Criterion | Classification | Supporting evidence / limit |
|---|---|---|
| Agentic capability | PARTIALLY PROVEN | Real source/tool/proposal/apply/verify success on one finding; full live f06 unreliable. |
| Bharat impact | PARTIALLY PROVEN | INR examples and source-attributed CCPA context; no measured deployment impact. |
| Technical implementation | PROVEN | Build, real browser gates, unit/integration/E2E checks, verified pack+chain, negative gate tests. Scoped to tested fixtures/local machine. |
| Innovation | PARTIALLY PROVEN | Agent proposal separated from deterministic verdict and inspectable evidence; comparative novelty not established. |
| User experience | PROVEN | Saved/guided journey, breakpoint screenshots and navigation checks. No independent user study. |
| Scalability & feasibility | PARTIALLY PROVEN | Local React-source workflow works; quotas and per-audit builds constrain live delivery; no load/multi-tenant evidence. |
| Demo readiness | PARTIALLY PROVEN | Recorded live success and reliable guided engine run; local MP4 finished; video upload and stable full live scenario pending. |

## Final blockers and handoff

**SUBMISSION BLOCKERS:** provider quota reliability for the planned live stage flow; video upload; pitch deck; final commit/push and verification of the judge's demo destination. Full live f06 has not passed after its final engine repair.

**IMPORTANT BUT NON-BLOCKING:** large web chunk; unknown pack version fields/no runtime screenshot artifacts; unsigned evidence; static-analysis limits; physical audio not certified.

**VERIFIED WORKING:** single-finding live agent with G1–G5 and matching pack/trace; guided mixed outcomes; saved sample; robot-position screenshots; responsive navigation; scoped secret scan; builds and automated suites.

**UNVERIFIED:** public deployment, clean-machine setup, human listening review of narration, uploaded-video playback, full live f06 completion under sufficient quota, scale, multilingual capability, legal conclusions.

**REQUIRED MANUAL ACTIONS FROM CREATOR:** provide sufficient provider quota for a stage rehearsal; review the synthetic narration and upload the finished MP4; finish/upload the deck; confirm team spellings; commit/push reviewed changes and check submitted links from an independent browser.

**SAFE TO FREEZE REPO? NO** — the core demo evidence is real, but the known full-scenario reliability and submission-asset gaps remain.
