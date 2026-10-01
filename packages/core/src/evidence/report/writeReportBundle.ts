// Writes the pramaan-report/<auditId>/ directory to disk — Spec Section 15.1.
//
// This is the only file in evidence/report/** that touches the filesystem;
// renderReportHtml/renderReadmeTxt stay pure. It writes:
//   index.html          via renderReportHtml
//   evidence-pack.json  via JSON.stringify(pack, null, 2) — pretty-printed
//                        for human readability when someone opens the file
//                        directly. This does NOT affect verifiability: the
//                        evidence hash is computed over the canonical form
//                        internally (pack.ts / canonical.ts), independent
//                        of how the JSON is later formatted on disk.
//   trace.jsonl         one JSON line per TraceEvent, only if traceEvents
//                        was provided
//   README.txt          via renderReadmeTxt
//
// It deliberately does NOT write diffs/ or screenshots/ — those come from
// the patch engine's diff output and the verify engine's screenshot
// capture, owned by other engineers. The report's relative references to
// those paths (./screenshots/<findingId>-before.png etc.) are just
// filename conventions; writeReportBundle does not assert those files
// exist.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EvidencePack, TraceEvent } from "../../types.js";
import { renderReportHtml } from "./index.html.js";
import { renderReadmeTxt } from "./readme.js";

export interface WriteReportBundleResult {
  indexPath: string;
  packPath: string;
  tracePath: string | null;
  readmePath: string;
}

/**
 * Writes a complete report bundle for `pack` into `outDir`
 * (typically `pramaan-report/<auditId>/`). Creates `outDir` if it does
 * not exist. Returns the absolute paths of every file it wrote.
 */
export async function writeReportBundle(
  pack: EvidencePack,
  traceEvents: TraceEvent[] | undefined,
  outDir: string,
): Promise<WriteReportBundleResult> {
  await mkdir(outDir, { recursive: true });

  const indexPath = path.join(outDir, "index.html");
  const packPath = path.join(outDir, "evidence-pack.json");
  const readmePath = path.join(outDir, "README.txt");

  const html = renderReportHtml(pack, traceEvents);
  const packJson = JSON.stringify(pack, null, 2);
  const readme = renderReadmeTxt(pack);

  await writeFile(indexPath, html, "utf8");
  await writeFile(packPath, packJson, "utf8");
  await writeFile(readmePath, readme, "utf8");

  let tracePath: string | null = null;
  if (traceEvents && traceEvents.length > 0) {
    tracePath = path.join(outDir, "trace.jsonl");
    const jsonl = traceEvents.map((ev) => JSON.stringify(ev)).join("\n") + "\n";
    await writeFile(tracePath, jsonl, "utf8");
  }

  return { indexPath, packPath, tracePath, readmePath };
}
