import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import {
  buildEvidencePack,
  renderReportHtml,
  err,
  zodIssues,
  pathExists,
  loadConfig,
  buildProjectModel,
  computeProtectedManifest,
  type EvidencePack,
} from "@pramaan/core";
import type { AuditStore } from "../store.js";
import { ENGINE_VERSION } from "../store.js";
import { resolveConfinedPath, defaultAllowedRoots } from "../security.js";
import { sendError } from "../errorHandler.js";
import { streamAuditEvents } from "../sse.js";

const sourceSchema = z.union([
  z.object({ type: z.literal("fixture"), id: z.string().min(1) }),
  z.object({ type: z.literal("path"), path: z.string().min(1) }),
]);

const createAuditSchema = z.object({
  source: sourceSchema,
  options: z
    .object({
      demoScenario: z.literal("mixed-outcomes").optional(),
      runtime: z.boolean().optional(),
      maxAttempts: z.number().int().min(1).max(5).optional(),
      autoApprovePreview: z.boolean().optional(),
    })
    .optional(),
});

const approvalDecisionSchema = z.object({
  decision: z.enum(["approve", "reject", "edit", "ignore"]),
  editedText: z.string().optional(),
});

const applySchema = z.object({ confirm: z.literal(true) });

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
    if (entry.isDirectory()) {
      await walkFiles(full, base, out);
    } else if (entry.isFile() && INCLUDE_EXT.has(path.extname(entry.name))) {
      out.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
}

function requireAudit(store: AuditStore, auditId: string) {
  const record = store.get(auditId);
  if (!record) {
    throw err("E_NOT_FOUND", `Audit ${auditId} not found`);
  }
  return record;
}

export function registerAuditRoutes(app: FastifyInstance, store: AuditStore): void {
  app.post("/api/audits", async (request, reply) => {
    const parsed = createAuditSchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(reply, "E_BAD_INPUT", "Invalid POST /api/audits body", { issues: zodIssues(parsed.error) });
      return;
    }
    const { source, options } = parsed.data;
    if (options?.demoScenario && (source.type !== "fixture" || source.id !== "f06-mitti-mart")) {
      sendError(reply, "E_BAD_INPUT", "The scripted demo is available only for the Mitti Mart fixture.");
      return;
    }

    let sourceRoot: string;
    try {
      if (source.type === "fixture") {
        sourceRoot = await resolveConfinedPath(path.join("fixtures", source.id));
      } else {
        sourceRoot = await resolveConfinedPath(source.path);
      }
    } catch (cause) {
      if (cause instanceof Error && "code" in cause) throw cause;
      sendError(reply, "E_BAD_INPUT", "Could not resolve source path");
      return;
    }

    if (!(await pathExists(sourceRoot))) {
      sendError(reply, "E_BAD_INPUT", `Source path does not exist: ${sourceRoot}`);
      return;
    }

    // Second POST for the same fixture/path creates a NEW workspace copy —
    // we never dedupe, per Section 17.5.
    const auditId = await store.createAudit(source, options ?? {}, sourceRoot);
    reply.status(202);
    return { auditId };
  });

  app.get("/api/audits/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = requireAudit(store, id);
    let protectedManifest: ReturnType<typeof computeProtectedManifest> = [];
    try {
      // Recomputed from the untouched baseline source (not the workspace,
      // which may already carry applied patches by the time this is
      // called) so it matches what runAudit used internally at audit start.
      const configPath = record.options.configPath ?? path.join(record.sourceRoot, "pramaan.config.json");
      const config = await loadConfig(configPath);
      const model = await buildProjectModel(record.sourceRoot, config);
      protectedManifest = computeProtectedManifest(model, config);
    } catch (cause) {
      request.log.warn({ auditId: id, cause }, "failed to recompute protectedManifest for GET /api/audits/:id");
    }
    return {
      audit: record.audit,
      proposals: record.proposals,
      approvals: record.approvals,
      protectedManifest,
    };
  });

  app.get("/api/audits/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };
    requireAudit(store, id); // throws E_NOT_FOUND if missing
    const lastEventId = (request.headers["last-event-id"] as string | undefined) ?? undefined;
    streamAuditEvents(store, id, reply, lastEventId);
    return reply;
  });

  app.get("/api/audits/:id/files", async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = requireAudit(store, id);
    const query = request.query as { path?: string; version?: string };
    if (!query.path) {
      sendError(reply, "E_BAD_INPUT", "?path= is required");
      return;
    }
    const version = query.version === "after" ? "after" : "before";
    const root = version === "after" ? record.workspaceRoot : record.sourceRoot;
    const allowedRoots = [...defaultAllowedRoots(), record.sourceRoot, record.workspaceRoot];
    const abs = await resolveConfinedPath(path.join(root, query.path), allowedRoots);

    let text: string;
    try {
      text = await readFile(abs, "utf-8");
    } catch {
      sendError(reply, "E_NOT_FOUND", `File not found: ${query.path} (${version})`);
      return;
    }
    const sha256 = createHash("sha256").update(text, "utf-8").digest("hex");
    return { path: query.path, version, sha256, text };
  });

  app.get("/api/audits/:id/diff", async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = requireAudit(store, id);
    const query = request.query as { proposalId?: string };

    if (query.proposalId) {
      const result = record.results.find((r) => r.proposalId === query.proposalId);
      if (!result) {
        sendError(reply, "E_NOT_FOUND", `No patch result for proposal ${query.proposalId}`);
        return;
      }
      return { diff: result.diff };
    }

    if (!(await pathExists(record.workspaceRoot))) {
      return { diff: "" };
    }
    const relFiles: string[] = [];
    await walkFiles(record.workspaceRoot, record.workspaceRoot, relFiles);
    const parts: string[] = [];
    for (const rel of relFiles) {
      const afterPath = path.join(record.workspaceRoot, rel);
      const beforePath = path.join(record.sourceRoot, rel);
      const after = await readFile(afterPath, "utf-8").catch(() => "");
      const before = (await pathExists(beforePath)) ? await readFile(beforePath, "utf-8") : "";
      if (before !== after) {
        parts.push(createTwoFilesPatch(rel, rel, before, after, "before", "after"));
      }
    }
    return { diff: parts.join("\n") };
  });

  app.post("/api/audits/:id/approvals/:approvalId", async (request, reply) => {
    const { id, approvalId } = request.params as { id: string; approvalId: string };
    requireAudit(store, id);
    const parsed = approvalDecisionSchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(reply, "E_BAD_INPUT", "Invalid approval decision body", { issues: zodIssues(parsed.error) });
      return;
    }
    try {
      const { approval } = store.resolveApproval(id, approvalId, parsed.data.decision, parsed.data.editedText);
      return { approval };
    } catch (cause) {
      const code = (cause as { code?: string })?.code;
      if (code === "E_NOT_FOUND" || code === "E_STATE_CONFLICT") {
        sendError(reply, code, (cause as Error).message);
        return;
      }
      throw cause;
    }
  });

  app.post("/api/audits/:id/apply", async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = requireAudit(store, id);
    const parsed = applySchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(reply, "E_BAD_INPUT", "apply requires { confirm: true }", { issues: zodIssues(parsed.error) });
      return;
    }
    if (store.isApplied(id)) {
      sendError(reply, "E_STATE_CONFLICT", `Audit ${id} has already been applied`);
      return;
    }
    if (!(await pathExists(record.workspaceRoot))) {
      sendError(reply, "E_STATE_CONFLICT", "Audit has no workspace to apply yet");
      return;
    }

    const relFiles: string[] = [];
    await walkFiles(record.workspaceRoot, record.workspaceRoot, relFiles);
    const filesWritten: string[] = [];
    for (const rel of relFiles) {
      const afterPath = path.join(record.workspaceRoot, rel);
      const beforePath = path.join(record.sourceRoot, rel);
      const after = await readFile(afterPath, "utf-8").catch(() => undefined);
      if (after === undefined) continue;
      const before = (await pathExists(beforePath)) ? await readFile(beforePath, "utf-8") : undefined;
      if (before !== after) {
        const { writeFile, mkdir } = await import("node:fs/promises");
        await mkdir(path.dirname(beforePath), { recursive: true });
        await writeFile(beforePath, after, "utf-8");
        filesWritten.push(rel);
      }
    }
    store.markApplied(id);
    await store.appendTrace(id, { type: "patch.applied", actor: "engine", payload: { filesWritten } });
    return { filesWritten };
  });

  function buildPackForRecord(record: ReturnType<typeof requireAudit>): EvidencePack {
    return buildEvidencePack({
      audit: record.audit,
      engine: {
        version: ENGINE_VERSION,
        node: process.version,
        playwright: process.env.PRAMAAN_RUNTIME === "off" ? "disabled" : "enabled",
        regulationDataVersion: "india-1",
      },
      llm: {
        provider: record.options.demoScenario ? "replay" : "anthropic",
        model: record.options.demoScenario ? "scripted-tool-sequence" : process.env.LLM_MODEL ?? "unset",
        temperature: 0,
        mode: record.options.demoScenario ? "replay" : (process.env.PRAMAAN_AGENT_MODE as "live" | "replay") ?? "live",
      },
      config: {},
      files: [],
      findings: record.audit.findings.map((finding) => ({
        finding,
        proposals: record.proposals
          .filter((p) => p.findingId === finding.findingId)
          .map((proposal) => ({
            proposal,
            result: record.results.find((r) => r.proposalId === proposal.proposalId) ?? {
              proposalId: proposal.proposalId,
              applied: false,
              filesChanged: [],
              diff: "",
              policyViolations: [],
            },
            verify: record.verifies.find((v) => v.findingId === finding.findingId) ?? null,
          })),
        approvals: record.approvals.filter((a) => a.findingId === finding.findingId),
      })),
      artifacts: [],
      traceHead: record.trace.at(-1)?.hash ?? "0".repeat(64),
    });
  }

  async function completedPack(record: ReturnType<typeof requireAudit>): Promise<EvidencePack> {
    const event = [...record.trace].reverse().find(e => e.type === "evidence.generated");
    if (record.audit.completedAt && record.audit.evidenceHash && typeof event?.payload.packPath === "string") {
      const packPath = await resolveConfinedPath(event.payload.packPath, [path.join(record.sourceRoot, "pramaan-report")]);
      const pack = JSON.parse(await readFile(packPath, "utf-8")) as EvidencePack;
      if (pack.evidenceHash !== record.audit.evidenceHash) throw err("E_STATE_CONFLICT", "The recorded evidence hash does not match the generated pack.");
      return pack;
    }
    return buildPackForRecord(record);
  }

  app.get("/api/audits/:id/evidence", async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = requireAudit(store, id);
    return completedPack(record);
  });

  app.get("/api/audits/:id/report", async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = requireAudit(store, id);
    const pack = await completedPack(record);
    reply.type("text/html");
    return renderReportHtml(pack, record.trace);
  });

  app.get("/api/audits/:id/artifacts/*", async (request, reply) => {
    const { id } = request.params as { id: string; "*": string };
    const record = requireAudit(store, id);
    const relPath = (request.params as Record<string, string>)["*"] ?? "";
    const artifactsRoot = path.join(record.dir, "artifacts");
    const abs = await resolveConfinedPath(path.join(artifactsRoot, relPath), [artifactsRoot]);
    try {
      const st = await stat(abs);
      if (!st.isFile()) throw new Error("not a file");
    } catch {
      sendError(reply, "E_NOT_FOUND", `Artifact not found: ${relPath}`);
      return;
    }
    return reply.send(await readFile(abs));
  });
}
