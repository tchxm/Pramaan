// `pramaan inspect <findingId>` — no LLM. Full detail: evidence, signals,
// cascade, regulation basis. Spec Section 16.1.
import { findFinding } from "../localStore.js";
import { bold, dim } from "../render/colors.js";

export async function runInspect(
  projectRoot: string,
  findingId: string,
  opts: { audit?: string; json?: boolean },
): Promise<number> {
  const found = await findFinding(projectRoot, findingId, opts.audit);
  if (!found) {
    console.error(`No finding ${findingId} found in local audit state under ${projectRoot}/.pramaan/audits`);
    return 2;
  }
  const { finding } = found;

  if (opts.json) {
    console.log(JSON.stringify(finding, null, 2));
    return 0;
  }

  console.log(bold(`${finding.findingId} — ${finding.title}`));
  console.log(`${finding.severity} · ${finding.pattern} · ${finding.status} · ${finding.location.file}:${finding.location.startLine}`);
  console.log("");
  console.log(bold("Evidence"));
  console.log(finding.evidence.sourceSnippet);
  if (finding.evidence.warnings.length > 0) {
    console.log(dim(`warnings: ${finding.evidence.warnings.join(", ")}`));
  }
  console.log("");
  console.log(bold("Signals"));
  for (const s of finding.signals) {
    console.log(`  ${s.id}  fired=${s.fired}  weight=${s.weight}`);
  }
  if (finding.evidence.cascade && finding.evidence.cascade.length > 0) {
    console.log("");
    console.log(bold("CSS cascade"));
    for (const c of finding.evidence.cascade) {
      console.log(`  ${c.winner ? "* " : "  "}${c.selector} { ${c.property}: ${c.value}${c.important ? " !important" : ""} } (${c.file}:${c.line})`);
    }
  }
  console.log("");
  console.log(bold("Regulation basis"));
  for (const r of finding.regulation) {
    console.log(`  ${r.framework} — ${r.patternName}`);
    console.log(`  ${r.plainBasis}`);
  }
  return 0;
}
