// Public API surface of @pramaan/core.
// Phase 1: contracts + stubs only. Real implementations land in later phases.

export * from "./types.js";
export * from "./errors.js";

export { loadConfig } from "./config.js";
export type { PramaanConfig } from "./config.js";

export { runDetectors } from "./detectors/index.js";

export { lookupRegulation } from "./regulation/index.js";

export { proposePatch, applyPatch } from "./patch/apply.js";
export type { ProposeInput } from "./patch/apply.js";
export { checkPolicy, computeProtectedManifest } from "./patch/policy.js";
export type { PolicyContext, ApprovalTokenInfo, ProtectedElementEntry } from "./patch/policy.js";
export { applyOp, CSS_PROPERTY_ALLOWLIST, FEE_DISCLOSURE_PATH, locateElement as locatePatchTargetElement } from "./patch/ops.js";
export type { ApplyOpContext, ApplyOpResult } from "./patch/ops.js";
export { buildProposalOps } from "./patch/strategies.js";
export type { StrategyInput, StrategyOutput } from "./patch/strategies.js";

export { verifyFinding } from "./verify/gates.js";

export { buildEvidencePack, verifyEvidencePack, DISCLAIMER } from "./evidence/pack.js";
export type { VerifyCheck, VerifyPackResult } from "./evidence/pack.js";
export { canonicalJson } from "./evidence/canonical.js";
export { appendEvent, verifyChain, computeEventHash, GENESIS_HASH } from "./evidence/chain.js";

export { buildProjectModel } from "./parser/project.js";
export * from "./parser/model.js";

export { parseJsxFile } from "./parser/jsx.js";
export type { JsxParseResult } from "./parser/jsx.js";
export { parseCssFile } from "./parser/css.js";
export type { CssParseResult } from "./parser/css.js";
export { resolveLabel } from "./parser/label.js";
export type { LabelMethod, LabelResult } from "./parser/label.js";
export { discoverFiles } from "./parser/discover.js";
export type { DiscoveredFiles } from "./parser/discover.js";

export { parseColor, compositeOver } from "./style/color.js";
export type { RgbaColor } from "./style/color.js";
export {
  expandVar,
  expandValue,
  resolveLength,
  resolveFontWeight,
  resolveColorValue,
} from "./style/values.js";
export type { ValueWarning, Resolved } from "./style/values.js";
export {
  toLinear,
  luminance,
  contrastRatio,
  contrastRatioFromStrings,
  resolveEffectiveContrast,
} from "./style/contrast.js";
export { resolveStyle, resolveBackgroundColor } from "./style/cascade.js";
export type {
  ResolvedStyle,
  ResolvedStyleProperty,
  ResolveStyleResult,
  CascadeContext,
  CascadeWarning,
  ResolvedBackground,
} from "./style/cascade.js";

export { computeFingerprint, normaliseAnchorText } from "./fingerprint.js";
export type { FingerprintInput } from "./fingerprint.js";

export {
  createWorkspace,
  diffFiles,
  snapshotFiles,
  restoreSnapshot,
  removeWorkspace,
  hashFile,
  pathExists,
} from "./workspace.js";
export type { Workspace, WorkspaceFile, Snapshot } from "./workspace.js";

// ---------- A3 (detectors / pricing) additions ----------
export { runDetectorsWithWarnings } from "./detectors/index.js";
export type { DetectorContext, DetectorWarning } from "./detectors/index.js";

export { basketSneaking, basketSneakingWarnings } from "./detectors/basketSneaking.js";
export { falseUrgency, falseUrgencyWarnings } from "./detectors/falseUrgency.js";
export {
  interfaceInterference,
  interfaceInterferenceWarnings,
  isInterfaceInterferenceClear,
  computeSignals as computeInterfaceInterferenceSignals,
  computeScore as computeInterfaceInterferenceScore,
  isFlagged as isInterfaceInterferenceFlagged,
} from "./detectors/interfaceInterference.js";
export type { SideStyle, PairSignals } from "./detectors/interfaceInterference.js";
export { dripPricing, dripPricingWarnings } from "./detectors/dripPricing.js";
export { findConfirmShamingCandidates } from "./detectors/confirmShamingCandidate.js";
export type { ConfirmShamingCandidate } from "./detectors/confirmShamingCandidate.js";

export { collectClickables, findPairs, classify as classifyAcceptReject, isClickable } from "./detectors/pairs.js";
export type { ClickRole, ClickableCandidate, AcceptRejectPair } from "./detectors/pairs.js";

export { extractLiteralAmounts, extractIdentifierAmounts, parseFeeConstants, parseLocalNumericConsts } from "./pricing/extract.js";
export type { ExtractedAmount } from "./pricing/extract.js";
export { findFeeItems, hasAnyDisplayedPrice, allDisplayedAmounts } from "./pricing/flow.js";
export type { FeeItemObservation } from "./pricing/flow.js";

// ---------- A5 (verification engine) additions ----------
export type { VerifyFindingInput } from "./verify/gates.js";
export { gate1DetectorClear, gate2Preservation, gate3Build, gate5NoRegression } from "./verify/gates.js";
export { startStaticServer } from "./verify/staticServer.js";
export type { StaticServerHandle } from "./verify/staticServer.js";
export { runProbe, resolveRoute } from "./verify/probes.js";
export type { ProbeResult } from "./verify/probes.js";
export { runRuntimeGate, runBaselineProbes, captureScreenshot } from "./verify/runtime.js";
export type { BaselineProbeRecord } from "./verify/runtime.js";

// ---------- A8 (evidence / report) additions ----------
export { renderReportHtml, escapeHtml } from "./evidence/report/index.html.js";
export { renderReadmeTxt } from "./evidence/report/readme.js";
export { writeReportBundle } from "./evidence/report/writeReportBundle.js";
export type { WriteReportBundleResult } from "./evidence/report/writeReportBundle.js";
