import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { PatternId, RegulationRef } from "../types.js";
import { err } from "../errors.js";

interface IndiaRegulationData {
  regulationDataVersion: string;
  auditDuty: string;
  patterns: Record<
    string,
    { patternName: string; framework: string; plainBasis: string; verifiedAgainstGazette: boolean }
  >;
}

let cache: IndiaRegulationData | null = null;

async function loadData(): Promise<IndiaRegulationData> {
  if (cache) return cache;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const raw = await readFile(path.join(here, "data", "india.json"), "utf-8");
  cache = JSON.parse(raw) as IndiaRegulationData;
  return cache;
}

/**
 * lookupRegulation(pattern) — Spec Section 11. Attached to every finding at
 * creation time. Never edited by the agent.
 */
export async function lookupRegulation(pattern: PatternId): Promise<RegulationRef[]> {
  const data = await loadData();
  const entry = data.patterns[pattern];
  if (!entry) {
    throw err("E_UNKNOWN_PATTERN", `No regulation data for pattern "${pattern}"`);
  }
  return [
    {
      jurisdiction: "IN",
      framework: entry.framework,
      patternName: entry.patternName,
      auditDuty: data.auditDuty,
      plainBasis: entry.plainBasis,
      verifiedAgainstGazette: entry.verifiedAgainstGazette,
    },
  ];
}
