// Zero-dependency constants safe to import from any consumer, including the
// web bundle, without pulling in the rest of @pramaan/core's module graph
// (parser, detectors, patch, verify/runtime — the latter imports Playwright,
// which has native optional deps a browser bundler cannot resolve). Exposed
// via a dedicated package.json "exports" subpath, "@pramaan/core/constants".

// Spec Section 3.4 — mandatory, verbatim, used in the CLI footer, the
// evidence report, and the UI.
export const DISCLAIMER =
  "Pramaan identifies technical patterns associated with deceptive interfaces, maps them to relevant regulatory guidance, and produces evidence supporting a self-audit. It does not provide legal certification.";
