// PRM-002 False Urgency (AST) — Spec Section 10.2.
// Pure function (model, config) -> Finding[]. No I/O, no LLM.
//
// NOTE on raw-source usage: the locked jsx.ts parser does not walk into
// non-literal JSX expression children (e.g. `{mm}:{ss}`, `` `Resend in ${s}` ``)
// — see parser/jsx.ts populateChildren's documented limitation. Rendered
// text and "is the getter referenced in JSX" checks therefore operate on
// the raw file source sliced by node ranges/offsets rather than on
// `textChildren`, which only captures literal text/string/number children.
// This is documented further in KNOWN RISKS.

import type { Finding } from "../types.js";
import type { ComponentModel, ProjectModel } from "../parser/model.js";
import type { PramaanConfig } from "../config.js";
import { computeFingerprint } from "../fingerprint.js";
import { buildEvidence, rawSlice, signal, type DetectorWarning } from "./util.js";

const DECREMENT_RE = /\w+\s*-\s*1\b|\w+\s*-=\s*1\b|--\s*\w+\b/;
const UTILITY_RE = /\botp\b|\bresend\b|verification|verify code|one-time|session\s*(?:timeout|expire)|auto.?logout|redirect/i;
const RESEND_TEXT_RE = /resend|try again in/i;
const URGENCY_RE = /expire|limited|hurry|ending|remaining|last chance|flash|only .* left|deal ends|offer ends/i;
const MODULE_CONST_RE = /\bconst\s+(\w+)\s*=\s*(-?\d+(?:\.\d+)?)\s*;/g;

interface Seed {
  getter: string;
  setter: string;
  value: number;
}

function findSeeds(component: ComponentModel, fileSource: string): Seed[] {
  const moduleConsts = new Map<string, number>();
  let m: RegExpExecArray | null;
  MODULE_CONST_RE.lastIndex = 0;
  while ((m = MODULE_CONST_RE.exec(fileSource))) {
    moduleConsts.set(m[1] as string, Number(m[2]));
  }

  const seeds: Seed[] = [];
  for (const hook of component.useState) {
    if (typeof hook.initialLiteral === "number") {
      seeds.push({ getter: hook.getter, setter: hook.setter, value: hook.initialLiteral });
      continue;
    }
    if (
      hook.initialExpressionSource &&
      /^[A-Za-z_$][\w$]*$/.test(hook.initialExpressionSource) &&
      moduleConsts.has(hook.initialExpressionSource)
    ) {
      seeds.push({ getter: hook.getter, setter: hook.setter, value: moduleConsts.get(hook.initialExpressionSource) as number });
    }
    // Anything else (prop, fetch result, context, Date/timestamp field,
    // function initializer referencing expiresAt/deadline/etc.) is not a
    // literal seed -> not eligible, which is exactly the server-backed
    // expiry exclusion (spec 10.2): such seeds simply never reach this list.
  }
  return seeds;
}

/** Identifiers "derived" from `getter` via same-file `const X = <expr
 * referencing getter>` helpers (spec: "through a same-file helper that
 * formats it, e.g. mm:ss"). One level of indirection. */
function derivedIdentifiers(componentSource: string, getter: string): string[] {
  const derived: string[] = [getter];
  const declRe = /\b(?:const|let)\s+(\w+)\s*=\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(componentSource))) {
    const name = m[1] as string;
    const expr = m[2] as string;
    if (new RegExp(`\\b${getter}\\b`).test(expr)) derived.push(name);
  }
  return derived;
}

export function falseUrgency(model: ProjectModel, config: PramaanConfig): Finding[] {
  void config;
  const findings: Finding[] = [];

  for (const file of model.files) {
    for (const component of file.components) {
      if (!component.jsxRoot) continue;
      const componentSource = rawSlice(file, component.range);
      const jsxSource = rawSlice(file, component.jsxRoot.range);

      const seeds = findSeeds(component, file.source);
      if (seeds.length === 0) continue;

      for (const seed of seeds) {
        const effect = component.useEffects.find(
          (ue) => ue.hasIntervalOrTimeout && new RegExp(`\\b${seed.setter}\\b`).test(ue.bodySource) && DECREMENT_RE.test(ue.bodySource),
        );
        if (!effect) continue;

        const derived = derivedIdentifiers(componentSource, seed.getter);
        const renderedRe = new RegExp(`\\b(?:${derived.join("|")})\\b`);
        if (!renderedRe.test(jsxSource)) continue; // not rendered -> not a visible countdown

        if (UTILITY_RE.test(componentSource) || RESEND_TEXT_RE.test(jsxSource)) continue; // utility-timer exclusion

        const urgencyMatch = URGENCY_RE.exec(jsxSource);
        if (!urgencyMatch) continue; // handled by falseUrgencyWarnings: COUNTDOWN_WITHOUT_URGENCY_TEXT

        const anchorText = urgencyMatch[0];
        const fingerprint = computeFingerprint({
          ruleId: "PRM-002",
          file: file.path,
          componentName: component.name,
          jsxPath: component.jsxRoot.jsxPath,
          anchorText,
        });

        findings.push({
          findingId: "",
          ruleId: "PRM-002",
          pattern: "FALSE_URGENCY",
          severity: "high",
          status: "open",
          detector: "AST",
          location: {
            file: file.path,
            startLine: component.jsxRoot.range.startLine,
            startColumn: component.jsxRoot.range.startColumn,
            endLine: component.jsxRoot.range.endLine,
            endColumn: component.jsxRoot.range.endColumn,
          },
          fingerprint,
          title: "Countdown timer creates false urgency",
          evidence: buildEvidence({
            file,
            range: component.jsxRoot.range,
            observed: {
              seedGetter: seed.getter,
              seedValue: seed.value,
              urgencyText: anchorText,
            },
          }),
          signals: [
            signal("S_COUNTDOWN_STRUCTURE", true, 1, { seed: seed.value, setter: seed.setter }),
            signal("S_URGENCY_TEXT_MATCH", true, 1, { match: anchorText }),
          ],
          score: null,
          requiresReview: false,
          regulation: [],
          attempts: 0,
        });

        break; // one finding per qualifying seed's component is enough; avoid
        // duplicate findings if multiple useEffects reference the same seed.
      }
    }
  }

  return findings;
}

export function falseUrgencyWarnings(model: ProjectModel, config: PramaanConfig): DetectorWarning[] {
  void config;
  const warnings: DetectorWarning[] = [];
  for (const file of model.files) {
    for (const component of file.components) {
      if (!component.jsxRoot) continue;
      const componentSource = rawSlice(file, component.range);
      const jsxSource = rawSlice(file, component.jsxRoot.range);
      const seeds = findSeeds(component, file.source);
      for (const seed of seeds) {
        const effect = component.useEffects.find(
          (ue) => ue.hasIntervalOrTimeout && new RegExp(`\\b${seed.setter}\\b`).test(ue.bodySource) && DECREMENT_RE.test(ue.bodySource),
        );
        if (!effect) continue;
        const derived = derivedIdentifiers(componentSource, seed.getter);
        const renderedRe = new RegExp(`\\b(?:${derived.join("|")})\\b`);
        if (!renderedRe.test(jsxSource)) continue;
        if (UTILITY_RE.test(componentSource) || RESEND_TEXT_RE.test(jsxSource)) continue;
        if (!URGENCY_RE.test(jsxSource)) {
          warnings.push({
            code: "COUNTDOWN_WITHOUT_URGENCY_TEXT",
            message: `Countdown structure found in ${file.path} component ${component.name} with no adjacent urgency text`,
            file: file.path,
          });
        }
      }
    }
  }
  return warnings;
}
