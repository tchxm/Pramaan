# PRAMAAN — two-minute submission film

**Concept: “The price changed. The shopper didn't choose it.”**

Make the judge understand the problem in eight seconds, the product by twenty-three seconds, and its technical credibility through an actual repair. The visual payoff is the checkbox becoming optional, followed by five independently passed gates and verifiable evidence. Keep approximately 105 seconds on product screens; the robot/sphere establish identity briefly.

Category: **Developer & AI**. Team: **DrCode — Mohammed Afnan and Shivam Kumar**. The supplied YouTube page was inaccessible; this is an original editing direction, not a claim that its shots or soundtrack were inspected. Creative discretion was explicitly authorized.

## Locked 120-second timeline

| Time | Screen recording / edit | Exact narration | Caption |
|---|---|---|---|
| 00:00–00:08 | Tight crop on `/demo` coffee price; reveal payment total. Hold ₹799, then ₹887. One quiet impact sound at the change. | “Seven hundred and ninety-nine rupees. At payment: eight hundred and eighty-seven. Same coffee. Who chose the extra charges?” | ₹799 → ₹887 · sample checkout |
| 00:08–00:23 | Highlight the preselected ₹49 protection and late ₹39 fee. Brief hero/CRT cut, then back to product. | “Preselected extras, false countdowns, hidden fees. PRAMAAN finds deceptive checkout patterns in React source, proposes bounded fixes, and checks the result. India's CCPA has advised e-commerce platforms to self-audit for dark patterns.” | Find → propose → independently verify |
| 00:23–00:35 | Explicit transition to `PRM-2026-000115`: source location, finding and checkbox's `useState(true)`. Keep its audit ID visible. This is the isolated single-finding fixture, not Mitti Mart. | “Here's a recorded live-agent run on a single-finding test project. The detector identifies a paid extra selected before the shopper chooses it, and links the finding to its source.” | LIVE MODEL RUN · single-finding fixture |
| 00:35–00:55 | Real trace: `source.read`, `patch.propose`. Expand relevant recorded inputs/results. Show strategy `checkbox.default_off`; briefly highlight agent/engine provenance. Cut idle waiting; caption that waits were shortened. | “The agent reads that source and chooses a whitelisted repair strategy. It proposes the change; it cannot declare success. Typed tools pass the proposal to the engine, which constructs the exact edit and checks its policy.” | Understand → reason → plan → use tools |
| 00:55–01:15 | Same audit's actual Diff: true → false. Then show its actual original/patched fixture in a browser if recording that additional shot; otherwise stay on the diff and source. Do not show the fixed-price Mitti Mart illustration as this live fixture. | “The patch changes one initial value from true to false, inside an isolated workspace. Delivery protection stays available. The shopper opts in. The forty-nine-rupee add-on is no longer automatic, and the original project remains untouched.” | ACT · explicit choice restored |
| 01:15–01:35 | Same audit outcome; crop and hold actual G1–G5 passes. Use five plain-language overlays, synced to the checks. No artificial green animation replacing real results. | “Now the engine checks five things: the target pattern is cleared, protected values are preserved, the project builds, browser behavior passes, and no new findings appear. All five pass. The engine returns VERIFIED: one finding, zero unresolved.” | Pattern · preservation · build · browser · regression |
| 01:35–01:50 | Actual evidence report/download, then `/verify` with **both** captured `evidence-pack.json` and matching `trace.jsonl`. Show all three integrity checks passing. | “The evidence pack records the proposal, results and source hashes. Its matching trace verifies the chain and its committed head. Unresolved work stays visible in other audits. This supports technical self-auditing; it does not certify legal compliance.” | DELIVER · pack hash + trace chain + trace head |
| 01:50–02:00 | Clean end frame; logo, team, Developer & AI, verified repository URL. A final product outcome remains behind the frame. | “PRAMAAN. The agent proposes. The engine decides. Developers get a checked fix and an inspectable record. Find the deception. Check the fix. Show the proof.” | PRAMAAN · DrCode · Developer & AI |

This script is 249 words. Aim for a clear 125–135 words/minute overall, with a slightly quicker opening and pauses for the proof screens. Trim idle footage to the locked timeline. The export must be checked at **120 seconds**; a timed narration recording has not yet been produced. Do not rush the five-check sequence; shorten narration if your natural pace is slower.

## Visual and sound direction

- Preserve the site's near-black, ivory and cyan/mint palette. Amber means unresolved/review; green accompanies actual engine passes. Keep text contrast high.
- Open immediately on the shopper problem. Use two deliberate price reveals, then steady screen footage. One robot shot is enough; avoid spending the opening on entry animation.
- Use smooth crops into real source, proposal and gate rows. Crop within the captured frame; do not rebuild the app in an editor. Every figure or verdict should remain legible on a phone.
- Use a restrained instrumental pulse under a human voice: build slightly through investigation, briefly drop it as the verdict appears, resolve on the proof frame. Use music licensed for the submission. Do not reuse the reference video's soundtrack without rights.
- Captions should describe the action, not repeat a paragraph. Keep them outside the controls being demonstrated. Use maximum two lines, roughly 4–7 words per line, strong contrast and stable placement.
- Record with browser zoom and cursor placement fixed. Hide personal tabs, notifications and provider configuration. Disable site narration while recording the film's voiceover.
- Hard cuts follow a clicked action; slow zooms follow a key result. A match cut from the real checkbox line to the actual unchecked checkbox is the central visual payoff. Avoid fake terminal typing or synthetic agent decisions.

## Recording assets already captured

The real **live** sequence is `PRM-2026-000115`, Groq `openai/gpt-oss-120b`. Source read, proposal, apply and verification were observed through the API/UI. All G1–G5 pass; evidence hash, trace chain and trace-head checks pass. The raw recording is a reusable clip, not the finished two-minute movie.

Local directory (Git-ignored): `packages/web/qa/submission-audit/live-footage/`

| Asset | Use |
|---|---|
| `live-audit-raw.webm` | Actual 1440×900 browser recording; cut idle waits, preserve sequence. |
| `proof-raw.webm`, `verified-pack.png` | Actual `/verify` footage: all three checks pass with the recorded pack and matching trace. |
| `workspace.png`, `diff.png`, `outcome.png` | Reference frames / held shots. |
| `record.json` | Audit identity, recorded final state and integrity results. |
| `evidence-pack.json` + `trace.jsonl` | Upload together to `/verify` for the integrity shot. |

Live workspace: `http://127.0.0.1:5173/audit/PRM-2026-000115`. Outcome: append `/outcome`. These are local recording destinations, **not public submission URLs**. The startup path is `npm run demo`; reuse the currently running Vite/API sessions where appropriate.

Saved opening illustration: `/demo`; shows ₹887 → ₹838 after removing the automatic ₹49 extra, with the ₹39 late fee unresolved. The live single-finding fixture shows ₹848 → ₹799 and has no late-fee/timer findings. The transition at 00:23 makes that difference explicit.

The guided four-finding audit is separate: “Scripted decisions · actual engine execution.” Its 4/1/1/2 mixed outcomes are not the results of the live single-finding audit. Omit it from the main 120-second cut unless the edit retains that label and explicitly introduces it as a different demonstration.

## Production shot list (completed)

1. Record 8–15 seconds of the saved checkout price reveal and protection choice, without calling it a live model run.
2. Record 2–3 seconds of the hero/CRT for identity.
3. Revisit the captured live audit and record readable expansions of its source/tool/proposal details if the raw clip is too small. Do not start a new model run just to manufacture faster timing.
4. Optionally run the actual original and isolated patched f01 fixture in separate browser tabs to record the true unchecked checkbox. Otherwise use the actual source diff; do not substitute the Mitti Mart illustration.
5. Use the captured `/verify` clip with the pack and **matching engine-prefix trace**; hold the three successful checks.
6. Record narration using [VOICEOVER.md](VOICEOVER.md), add licensed music and captions, and export the assembled film.

## Export and final review

Target 1920×1080 H.264 MP4, 30 fps, AAC 48 kHz. Captured 1440×900 footage needs deliberate framing within 16:9; do not stretch it. Use a quiet background or crop consistently. Set delivery duration to 120 seconds. Suggested filename: `PRAMAAN_DrCode_2min_demo.mp4`.

Before uploading, play the export once with sound and once muted. Within the first 23 seconds a fresh viewer should know **who it helps, what it detects, and what it does**. They should see one real live repair, real independent gates and verifiable evidence. Check IDs, readable figures, labels, narration timing, audio clipping and the final destination link. Verify the uploaded video from an independent browser.

Repository end-card URL: `https://github.com/tchxm/Pramaan` matches the local Git remote. Independently confirm public access after pushing the final changes. Add a demo URL only after verifying it; no public demo URL was established in the audit.

Readiness: [finished 120-second 1080p MP4](../../deliverables/PRAMAAN_DrCode_2min_demo.mp4) exported with synthetic Indian-English narration, burned captions and original instrumental music. Full decode passed (3,600 frames); measured audio is −16 LUFS with −2.7 dBFS true peak. Key frames reviewed after caption/layout corrections. Video upload and full-scenario stage reliability remain pending. See [SUBMISSION_AUDIT.md](../SUBMISSION_AUDIT.md).
