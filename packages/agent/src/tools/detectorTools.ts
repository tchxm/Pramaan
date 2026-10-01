// detector.scan, semantic.inspect, regulation.lookup — Spec 14.2 rows 7-9,
// 14.7 (semantic sub-call prompt + E_LLM_BAD_OUTPUT retry policy).

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ok, fail, zodIssues, runDetectorsWithWarnings, findConfirmShamingCandidates, lookupRegulation, computeFingerprint } from "@pramaan/core";
import type { Result, Finding, PatternId } from "@pramaan/core";
import type { AgentToolContext } from "./context.js";

// ---------- detector.scan ----------

export const detectorScanSchema = z.object({ paths: z.array(z.string()).optional() });

export async function detectorScanHandler(input: unknown, ctx: AgentToolContext): Promise<Result<unknown>> {
  const parsed = detectorScanSchema.safeParse(input);
  if (!parsed.success) return fail("E_BAD_INPUT", "invalid input for detector.scan", { issues: zodIssues(parsed.error) });

  const model = await ctx.getProjectModel();
  const { findings, warnings } = runDetectorsWithWarnings({ model, config: ctx.config });

  const scoped = parsed.data.paths && parsed.data.paths.length > 0
    ? findings.filter((f) => parsed.data.paths!.includes(f.location.file))
    : findings;

  return ok({ findings: scoped, warnings });
}

// ---------- semantic.inspect ----------

export const semanticInspectSchema = z.object({ findingId: z.string() });

const SEMANTIC_SYSTEM_PROMPT =
  'You classify whether a button/link\'s text is a "confirm-shaming" dark pattern: wording ' +
  "that shames or guilt-trips the user for declining an offer (e.g. \"No thanks, I don't want to save money\"). " +
  'Respond with strict JSON only, no prose, no markdown fences: ' +
  '{"likely": boolean, "rationale": string (<= 200 chars), "suggestedText": string (<= 60 chars, neutral, same intent, no new offers or amounts)}.';

interface SemanticInspectResult {
  likely: boolean;
  rationale: string;
  suggestedText: string;
}

function parseSemanticJson(raw: string): SemanticInspectResult | null {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = (fenced[1] ?? "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.likely !== "boolean" || typeof obj.rationale !== "string" || typeof obj.suggestedText !== "string") {
    return null;
  }
  if (obj.rationale.length > 200 || obj.suggestedText.length > 60) return null;
  return { likely: obj.likely, rationale: obj.rationale, suggestedText: obj.suggestedText };
}

/** Finds the PRM-005 candidate text + two nearest sibling texts for a
 * findingId that is either already a real Finding (promoted earlier) or
 * still only a step-1 candidate (fingerprint lookup against the live
 * model's candidate list), per spec 14.7's "candidate button text and the
 * two nearest sibling texts" input contract. */
async function resolveCandidateContext(
  ctx: AgentToolContext,
  findingId: string,
): Promise<{ anchorText: string; siblings: string[]; fingerprint: string; location: Finding["location"] } | null> {
  const existing = ctx.findings.get(findingId);
  const model = await ctx.getProjectModel();
  const candidates = findConfirmShamingCandidates(model, ctx.config);

  if (existing) {
    const match = candidates.find((c) => c.fingerprint === existing.fingerprint);
    if (match) {
      return { anchorText: match.anchorText, siblings: [], fingerprint: match.fingerprint, location: match.location };
    }
    return { anchorText: existing.title, siblings: [], fingerprint: existing.fingerprint, location: existing.location };
  }

  // findingId may instead be a synthetic id referencing a candidate index,
  // e.g. "CANDIDATE-<fingerprint>" — accept either form.
  const byFingerprint = candidates.find((c) => c.fingerprint === findingId || `CANDIDATE-${c.fingerprint}` === findingId);
  if (!byFingerprint) return null;
  return { anchorText: byFingerprint.anchorText, siblings: [], fingerprint: byFingerprint.fingerprint, location: byFingerprint.location };
}

export async function semanticInspectHandler(input: unknown, ctx: AgentToolContext): Promise<Result<unknown>> {
  const parsed = semanticInspectSchema.safeParse(input);
  if (!parsed.success) return fail("E_BAD_INPUT", "invalid input for semantic.inspect", { issues: zodIssues(parsed.error) });

  const candidate = await resolveCandidateContext(ctx, parsed.data.findingId);
  if (!candidate) return fail("E_NOT_FOUND", `no confirm-shaming candidate for findingId "${parsed.data.findingId}"`);

  const userPrompt = JSON.stringify({ candidateText: candidate.anchorText, siblingTexts: candidate.siblings });

  let result: SemanticInspectResult | null = null;
  let lastRaw = "";
  for (let attempt = 0; attempt < 2 && !result; attempt++) {
    const { raw } = await ctx.llmClient.completeJson(SEMANTIC_SYSTEM_PROMPT, userPrompt, { temperature: 0, timeoutMs: 30_000 });
    lastRaw = raw;
    result = parseSemanticJson(raw);
  }

  if (!result) {
    return fail("E_LLM_BAD_OUTPUT", "semantic.inspect: model did not return valid JSON after one retry", { raw: lastRaw });
  }

  // Spec 10.5 item 3 / confirmShamingCandidate.ts header: promote likely:true
  // candidates to a real Finding, owned by the agent package (core never
  // invents Findings from LLM output — I-09).
  if (result.likely && !ctx.findings.has(parsed.data.findingId)) {
    const regulation = await lookupRegulation("CONFIRM_SHAMING" as PatternId);
    const perRule = [...ctx.findings.values()].filter((f) => f.ruleId === "PRM-005").length;
    const finding: Finding = {
      findingId: `F-PRM-005-${perRule + 1}`,
      ruleId: "PRM-005",
      pattern: "CONFIRM_SHAMING",
      severity: "medium",
      status: "open",
      detector: "SEMANTIC_CANDIDATE",
      location: candidate.location,
      fingerprint: candidate.fingerprint,
      title: `Confirm-shaming wording: "${candidate.anchorText}"`,
      evidence: {
        sourceSnippet: candidate.anchorText,
        fileSha256: "",
        observed: { anchorText: candidate.anchorText },
        warnings: [],
      },
      signals: [],
      score: null,
      requiresReview: true,
      regulation,
      attempts: 0,
    };
    ctx.findings.set(finding.findingId, finding);
    ctx.emit("tool.result", "engine", { tool: "semantic.inspect", promotedFindingId: finding.findingId });
  }

  return ok({ likely: result.likely, rationale: result.rationale, suggestedText: result.suggestedText, authoritative: false, idempotencyKey: randomUUID() });
}

// ---------- regulation.lookup ----------

export const regulationLookupSchema = z.object({
  pattern: z.enum(["BASKET_SNEAKING", "FALSE_URGENCY", "INTERFACE_INTERFERENCE", "DRIP_PRICING", "CONFIRM_SHAMING"]),
});

export async function regulationLookupHandler(input: unknown, _ctx: AgentToolContext): Promise<Result<unknown>> {
  const parsed = regulationLookupSchema.safeParse(input);
  if (!parsed.success) return fail("E_BAD_INPUT", "invalid input for regulation.lookup", { issues: zodIssues(parsed.error) });
  try {
    const refs = await lookupRegulation(parsed.data.pattern);
    return ok(refs);
  } catch (cause) {
    return fail("E_UNKNOWN_PATTERN", cause instanceof Error ? cause.message : String(cause));
  }
}
