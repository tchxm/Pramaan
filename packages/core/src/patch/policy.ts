// Policy engine — Spec Section 12.4 (P1-P10) and Section 12.5 (protected
// element manifest). Runs before any write (I-02/I-03/I-04).

import { createHash } from "node:crypto";
import path from "node:path";
import type { Finding, PatchOpKind, PatchProposal, PolicyViolation, RuleId } from "../types.js";
import type { ComponentModel, JsxElementNode, ProjectModel } from "../parser/model.js";
import type { PramaanConfig } from "../config.js";
import { computeFingerprint, normaliseAnchorText } from "../fingerprint.js";
import { CSS_PROPERTY_ALLOWLIST, FEE_DISCLOSURE_PATH } from "./ops.js";

export interface ApprovalTokenInfo {
  auditId: string;
  findingId: string;
  proposalId: string;
  textSha256: string;
}

export interface PolicyContext {
  auditId: string;
  workspaceRoot: string;
  scannedFiles: Set<string>;
  protectedFingerprints: Set<string>;
  appliedProposalIds: Set<string>;
  attemptsByFinding: Map<string, number>;
  maxAttempts: number;
  /** The finding this proposal targets — needed for P3 (fingerprint match)
   * and P10 (attempt count). Supplied by the caller (apply.ts), which
   * already has the Finding on hand. */
  finding: Finding;
  /** Injection point for the server-side approval handshake (I-06). core
   * never implements HMAC/signature verification itself — it only calls
   * this callback and treats the boolean result as authoritative. */
  approvalTokenVerifier: (token: string, info: ApprovalTokenInfo) => boolean;
}

const ALLOWED_OP_KINDS: ReadonlySet<PatchOpKind> = new Set<PatchOpKind>([
  "SET_INITIAL_STATE_LITERAL",
  "WIRE_CONTROLLED_CHECKBOX",
  "SET_CSS_DECLARATION",
  "REMOVE_CSS_IMPORTANT",
  "REMOVE_JSX_ELEMENT",
  "INSERT_FEE_DISCLOSURE",
  "REPLACE_JSX_TEXT",
]);

// Spec 10.5 item 1, duplicated here deliberately (see KNOWN RISKS): the
// canonical copy lives in detectors/confirmShamingCandidate.ts, owned by
// another engineer and potentially still under construction. Policy P6 must
// be independently enforceable by patch/** without a cross-directory import.
const CONFIRM_SHAMING_PATTERNS: RegExp[] = [
  /\bno thanks?,?\s+i\b/i,
  /\bi (don'?t|do not) (want|like|need) to (save|be|get|win|protect)/i,
  /\bi (prefer|like|love|enjoy) (paying|losing|wasting|missing|risk)/i,
  /\bno,? i (hate|don'?t care)/i,
  /\bnot interested in (saving|protecting|deals)/i,
];

const CURRENCY_AMOUNT_RE = /(?:₹|Rs\.?|INR|\$)\s?\d[\d,]*(?:\.\d+)?/gi;

function extractAmounts(text: string): Set<string> {
  const matches = text.match(CURRENCY_AMOUNT_RE) ?? [];
  return new Set(matches.map((s) => s.replace(/\s+/g, "")));
}

function addsNewCurrencyAmount(from: string, to: string): boolean {
  const fromAmounts = extractAmounts(from);
  for (const amount of extractAmounts(to)) {
    if (!fromAmounts.has(amount)) return true;
  }
  return false;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

/** Real traversal defense: rejects `..` segments and anything that, once
 * resolved against workspaceRoot, escapes it — not just a string prefix
 * check. */
function checkPathAllowed(relFile: string, ctx: PolicyContext): string | null {
  const posixPath = relFile.split(path.sep).join("/");
  if (posixPath.split("/").some((seg) => seg === "..")) {
    return `path "${relFile}" contains a parent-traversal segment`;
  }
  if (path.posix.isAbsolute(posixPath) || /^[A-Za-z]:/.test(posixPath)) {
    return `path "${relFile}" must be relative to the workspace root`;
  }
  const normalized = path.posix.normalize(posixPath);
  if (normalized.startsWith("..")) {
    return `path "${relFile}" escapes the workspace root`;
  }
  const rootResolved = path.resolve(ctx.workspaceRoot);
  const resolved = path.resolve(ctx.workspaceRoot, normalized);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    return `path "${relFile}" resolves outside the workspace root`;
  }
  if (normalized === FEE_DISCLOSURE_PATH) return null;
  if (!ctx.scannedFiles.has(normalized)) {
    return `path "${relFile}" is not in the scanned file set`;
  }
  return null;
}

export function checkPolicy(proposal: PatchProposal, ctx: PolicyContext): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  if (proposal.ops.length > 12) {
    violations.push({
      code: "E_TOO_MANY_OPS",
      opId: "",
      message: `proposal ${proposal.proposalId} has ${proposal.ops.length} ops; maximum is 12`,
    });
  }

  if (ctx.appliedProposalIds.has(proposal.proposalId)) {
    violations.push({
      code: "E_ALREADY_APPLIED",
      opId: "",
      message: `proposal ${proposal.proposalId} has already been applied`,
    });
  }

  const attempts = ctx.attemptsByFinding.get(proposal.findingId) ?? 0;
  if (attempts >= ctx.maxAttempts) {
    violations.push({
      code: "E_ATTEMPTS_EXHAUSTED",
      opId: "",
      message: `finding ${proposal.findingId} has exhausted its ${ctx.maxAttempts} remediation attempts`,
    });
  }

  for (const op of proposal.ops) {
    if (!ALLOWED_OP_KINDS.has(op.kind)) {
      violations.push({ code: "E_OP_NOT_ALLOWED", opId: op.opId, message: `op kind "${op.kind}" is not whitelisted` });
      continue;
    }

    const pathViolation = checkPathAllowed(op.file, ctx);
    if (pathViolation) {
      violations.push({ code: "E_PATH_NOT_ALLOWED", opId: op.opId, message: pathViolation });
    }

    if (op.target.fingerprint && op.target.fingerprint !== ctx.finding.fingerprint) {
      violations.push({
        code: "E_TARGET_MISMATCH",
        opId: op.opId,
        message: `op targets fingerprint ${op.target.fingerprint} but proposal ${proposal.proposalId} is for finding ${ctx.finding.fingerprint}`,
      });
    }

    if (op.kind === "SET_CSS_DECLARATION" || op.kind === "REMOVE_CSS_IMPORTANT") {
      const property = typeof op.params.property === "string" ? op.params.property : "";
      if (!CSS_PROPERTY_ALLOWLIST.has(property)) {
        violations.push({ code: "E_PROPERTY_NOT_ALLOWED", opId: op.opId, message: `CSS property "${property}" is not in the allowlist` });
      }
    }

    if (op.kind === "REMOVE_JSX_ELEMENT") {
      const fp = op.target.fingerprint;
      const isProtected = !!fp && ctx.protectedFingerprints.has(fp);
      const isSingleRemovalException = ctx.finding.pattern === "FALSE_URGENCY";
      if (isProtected && !isSingleRemovalException) {
        violations.push({
          code: "E_PROTECTED_ELEMENT",
          opId: op.opId,
          message: `op removes protected element ${fp}; only the FALSE_URGENCY timer-element exception (12.3) is allowed`,
        });
      }
    }

    if (op.kind === "REPLACE_JSX_TEXT") {
      const token = typeof op.params.approvalToken === "string" ? op.params.approvalToken : "";
      const to = typeof op.params.to === "string" ? op.params.to : "";
      const from = typeof op.params.from === "string" ? op.params.from : "";

      if (to.length < 1 || to.length > 80) {
        violations.push({ code: "E_TEXT_NOT_ALLOWED", opId: op.opId, message: "replacement text must be 1-80 characters" });
      } else if (CONFIRM_SHAMING_PATTERNS.some((re) => re.test(to))) {
        violations.push({ code: "E_TEXT_NOT_ALLOWED", opId: op.opId, message: "replacement text matches the confirm-shaming filter" });
      } else if (addsNewCurrencyAmount(from, to)) {
        violations.push({ code: "E_TEXT_NOT_ALLOWED", opId: op.opId, message: "replacement text introduces a currency amount absent from the original" });
      } else {
        const textSha256 = sha256Hex(to);
        const valid =
          !!token &&
          ctx.approvalTokenVerifier(token, {
            auditId: ctx.auditId,
            findingId: proposal.findingId,
            proposalId: proposal.proposalId,
            textSha256,
          });
        if (!valid) {
          violations.push({ code: "E_APPROVAL_REQUIRED", opId: op.opId, message: "missing or invalid human approval token" });
        }
      }
    }
  }

  return violations;
}

// ============================================================
// 12.5 Protected element manifest
// ============================================================

export interface ProtectedElementEntry {
  fingerprint: string;
  kind: string;
  normalisedText: string;
}

const ALL_RULE_IDS: RuleId[] = ["PRM-001", "PRM-002", "PRM-003", "PRM-004", "PRM-005"];
const PAYMENT_RE = /pay|checkout|proceed|continue|place order/i;
const REJECT_RE = /no,?\s*thanks?|decline|reject|not now|not interested|no i\b|skip/i;
const ACCEPT_RE = /\byes\b|accept|agree|add to (cart|basket)|confirm/i;

function collectText(el: JsxElementNode): string {
  const parts: string[] = [...el.textChildren];
  for (const c of el.children) {
    const t = collectText(c);
    if (t) parts.push(t);
  }
  return parts.join(" ");
}

function classNameOf(el: JsxElementNode): string {
  const attr = el.attributes.find((a) => a.name === "className");
  return typeof attr?.literalValue === "string" ? attr.literalValue : "";
}

/**
 * Best-effort classifier. The authoritative "accept/reject control" concept
 * is defined by 10.3 discovery, which lives in detectors/** (owned by
 * another engineer, off-limits here). This is a deliberately independent,
 * conservative heuristic so P5/G2 do not have a hard dependency on that
 * module landing first — see KNOWN RISKS.
 */
function classify(el: JsxElementNode, config: PramaanConfig): string | null {
  const tag = el.tag.toLowerCase();
  const text = collectText(el);
  const className = classNameOf(el);

  if (tag === "form") return "form";

  if (tag === "input") {
    const typeAttr = el.attributes.find((a) => a.name === "type");
    const inputType = typeof typeAttr?.literalValue === "string" ? typeAttr.literalValue : "text";
    return ["checkbox", "radio"].includes(inputType) ? "checkbox_control" : "form_field";
  }
  if (tag === "select" || tag === "textarea") return "form_field";
  if (config.checkboxComponents.includes(el.tag)) return "checkbox_control";

  // Protect the element displaying a price, rather than every ancestor
  // whose aggregated text happens to include a descendant's currency.
  if (config.currency.some((sym) => el.textChildren.join(" ").includes(sym))) return "price";

  if (tag === "button" || tag === "a" || config.buttonComponents.includes(el.tag)) {
    const haystack = `${className} ${text}`;
    if (PAYMENT_RE.test(text)) return "payment_button";
    if (REJECT_RE.test(haystack) || /decline|reject|no-?thanks|dismiss/i.test(className)) return "reject_control";
    if (ACCEPT_RE.test(haystack) || /accept|cta-?yes|agree|confirm/i.test(className)) return "accept_control";
  }

  return null;
}

export function computeProtectedManifest(model: ProjectModel, config: PramaanConfig): ProtectedElementEntry[] {
  const entries: ProtectedElementEntry[] = [];
  for (const file of model.files) {
    for (const component of file.components) {
      if (!component.jsxRoot) continue;
      walk(component.jsxRoot, file.path, component, config, entries);
    }
  }
  return entries;
}

function walk(
  el: JsxElementNode,
  filePath: string,
  component: ComponentModel,
  config: PramaanConfig,
  out: ProtectedElementEntry[],
): void {
  const kind = classify(el, config);
  if (kind) {
    const rawText = collectText(el) || el.tag;
    const normalisedText = normaliseAnchorText(rawText);
    for (const ruleId of ALL_RULE_IDS) {
      out.push({
        fingerprint: computeFingerprint({
          ruleId,
          file: filePath,
          componentName: component.name,
          jsxPath: el.jsxPath,
          anchorText: rawText,
        }),
        kind,
        normalisedText,
      });
    }
  }
  for (const c of el.children) walk(c, filePath, component, config, out);
}
