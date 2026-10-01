// Regenerate the public, recorded example from the actual engine. No LLM required.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadConfig, createWorkspace, buildProjectModel, runDetectorsWithWarnings,
  computeProtectedManifest, proposePatch, applyPatch, verifyFinding } from '../packages/core/dist/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = path.join(root, 'fixtures/f06-mitti-mart');
const auditId = `saved-demo-${Date.now()}`;
const config = await loadConfig(path.join(source, 'pramaan.config.json'));
const workspace = await createWorkspace(source, auditId, path.join(root, '.pramaan'));
const model = await buildProjectModel(workspace.root, config);
const baseline = runDetectorsWithWarnings({ model, config });
const finding = baseline.findings.find(f => f.ruleId === 'PRM-001');
if (!finding || baseline.findings.length !== 4) throw Error('Demo baseline changed; review before publishing.');
const before = await readFile(path.join(workspace.root, finding.location.file), 'utf8');
const manifest = computeProtectedManifest(model, config);
const proposal = proposePatch({ finding, strategy: 'checkbox.default_off', params: {}, projectModel: model, config });
const patch = await applyPatch(workspace, proposal, config, {
  auditId, workspaceRoot: workspace.root, scannedFiles: new Set(model.files.map(f => f.path)),
  protectedFingerprints: new Set(manifest.map(e => e.fingerprint)), appliedProposalIds: new Set(),
  attemptsByFinding: new Map(), maxAttempts: 3, finding, approvalTokenVerifier: () => false,
});
if (!patch.applied) throw Error(JSON.stringify(patch.policyViolations));
const verification = await verifyFinding({ auditId, findingId: finding.findingId, finding, workspace, config,
  baselineManifest: manifest, baselineFindings: baseline.findings, baselineWarnings: baseline.warnings, appliedProposal: proposal });
if (verification.verdict !== 'VERIFIED') throw Error(JSON.stringify(verification));
const after = await readFile(path.join(workspace.root, finding.location.file), 'utf8');
const remaining = runDetectorsWithWarnings({ model: await buildProjectModel(workspace.root, config), config }).findings;
const record = { kind: 'recorded-engine-example', project: 'Mitti Mart', fixture: 'f06-mitti-mart',
  description: 'Recorded deterministic scan and one engine-generated fix. No live agent session is represented.',
  recordedAt: verification.verifiedAt, findings: baseline.findings, remainingFindings: remaining,
  source: { file: finding.location.file, before, after,
    beforeSha256: createHash('sha256').update(before).digest('hex'), afterSha256: createHash('sha256').update(after).digest('hex') },
  proposal, patch, verification };
const output = path.join(root, 'packages/web/public/demo');
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'mitti-mart.json'), JSON.stringify(record, null, 2) + '\n');
await writeFile(path.join(output, 'cart-fix.patch'), patch.diff);
console.log(`Saved ${baseline.findings.length} findings, ${verification.verdict}, ${remaining.length} remaining findings.`);
