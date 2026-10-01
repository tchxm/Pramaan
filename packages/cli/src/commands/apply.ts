// `pramaan apply <auditId> [--yes]` — shows cumulative diff, then copies
// patched files back to the original project. Spec Section 16.1.
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "@pramaan/core";
import { createTwoFilesPatch } from "diff";
import { loadState, saveState } from "../localStore.js";

const INCLUDE_EXT = new Set([".tsx", ".ts", ".jsx", ".js", ".css"]);
const EXCLUDE_DIRS = new Set(["node_modules", "dist", ".pramaan", ".git"]);

async function walkFiles(dir: string, base: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkFiles(full, base, out);
    else if (entry.isFile() && INCLUDE_EXT.has(path.extname(entry.name))) {
      out.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
}

export async function runApply(projectRoot: string, auditId: string, opts: { yes?: boolean }): Promise<number> {
  const state = await loadState(projectRoot, auditId);
  if (!state) {
    console.error(`Audit ${auditId} not found under ${projectRoot}/.pramaan/audits`);
    return 2;
  }
  if (state.applied) {
    console.error(`Audit ${auditId} has already been applied`);
    return 2;
  }
  const unchecked = state.proposals.some(proposal =>
    state.results.some(result => result.proposalId === proposal.proposalId && result.applied) &&
    !state.audit.findings.some(finding => finding.findingId === proposal.findingId && ["verified", "static_verified"].includes(finding.status)));
  if (!["completed", "completed_with_failures"].includes(state.audit.status) || unchecked) {
    console.error("Complete verification for every applied patch before writing changes to the project.");
    return 3;
  }
  if (!(await pathExists(state.workspaceRoot))) {
    console.error(`Audit ${auditId} has no workspace to apply yet`);
    return 3;
  }

  const relFiles: string[] = [];
  await walkFiles(state.workspaceRoot, state.workspaceRoot, relFiles);

  const changed: string[] = [];
  for (const rel of relFiles) {
    const after = await readFile(path.join(state.workspaceRoot, rel), "utf-8").catch(() => undefined);
    if (after === undefined) continue;
    const beforePath = path.join(state.sourceRoot, rel);
    const before = (await pathExists(beforePath)) ? await readFile(beforePath, "utf-8") : "";
    if (before !== after) {
      changed.push(rel);
      console.log(createTwoFilesPatch(rel, rel, before, after, "before", "after"));
    }
  }

  if (changed.length === 0) {
    console.log("No changes to apply.");
    return 0;
  }

  if (!opts.yes) {
    console.log(`\n${changed.length} file(s) would be written. Re-run with --yes to apply.`);
    return 0;
  }

  const filesWritten: string[] = [];
  for (const rel of changed) {
    const after = await readFile(path.join(state.workspaceRoot, rel), "utf-8");
    const dest = path.join(state.sourceRoot, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, after, "utf-8");
    filesWritten.push(rel);
  }

  state.applied = true;
  await saveState(projectRoot, state);
  console.log(`Applied ${filesWritten.length} file(s):`);
  for (const f of filesWritten) console.log(`  ${f}`);
  return 0;
}
