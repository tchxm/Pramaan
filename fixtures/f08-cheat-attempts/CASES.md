# F08 — cheat attempts (engine-level test scaffolding)

This fixture is not driven by the agent. It exists so `packages/core` unit
tests can exercise the patch-policy engine and the verification gates
(G1-G5) directly against a small checkout-like component: `src/pages/Cart.tsx`,
`src/styles.css` and `src/overrides.css` (the same cascade shape as F02: a
`.decline` rule in `styles.css` overridden by a higher-specificity
`!important` rule in `overrides.css`), plus a protected "No thanks" button
(`data-protected="true"`) and a `useEffect` that mutates
`declineRef.current.style.opacity` shortly after mount.

## F08a — reject a direct element-removal call
Setup: call the engine's patch-apply API directly with a `REMOVE_JSX_ELEMENT`
op targeting the "No thanks" button.
Expected: the policy engine rejects the op before it touches the workspace,
with `E_PROTECTED_ELEMENT`. No files change.

## F08b — preservation gate catches an out-of-band deletion
Setup: use a test-only `applyUnsafe` helper (bypassing the policy engine) to
delete the "No thanks" button from `Cart.tsx`, then run `verify`.
Expected: gate G1 (static re-scan) is clear on its own terms, but gate G2
(preservation check — the element the finding pointed at must still exist)
fails with `PRESERVATION_BROKEN`. The finding's verdict is `FAILED`.

## F08c — an inline style does not beat `!important` in cascade
Setup: add `style={{opacity: 1}}` inline on the "No thanks" button while
`.checkout .decline { opacity: .35 !important; }` remains in `overrides.css`.
Expected: gate G1 fails with `CSS_OVERRIDE_WINS` (the stylesheet
`!important` rule still wins over the inline declaration per CSS cascade
rules), and gate G4 (runtime probe) also fails because the computed opacity
in the browser is still 0.35, not the claimed 1.

## F08d — a syntactically invalid patch is rejected atomically
Setup: submit a patch whose text edit introduces a TSX syntax error (e.g. an
unclosed JSX tag) into `Cart.tsx`.
Expected: patch apply fails fast with `E_PATCH_PARSE_ERROR`. The whole
workspace is byte-identical to its pre-patch state (snapshot/rollback is
transactional — no partial write).

## F08e — a runtime-only mutation is invisible to static analysis
Setup: after a patch statically "fixes" the decline button's style
(matching what's already in this fixture's `Cart.tsx`: a `useEffect` that
sets `ref.current.style.opacity = "0.3"` ~50ms after mount).
Expected: gate G1 (static source inspection) passes — it is a static blind
spot, since the mutation only happens at runtime. Gate G4 (the Playwright
runtime probe, which waits for the effect to settle and reads the computed
style) fails with `RUNTIME_MISMATCH`, because the DOM's actual computed
opacity disagrees with what the static patch claimed.
