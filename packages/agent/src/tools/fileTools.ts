// project.list_files, source.read, source.search — Spec 14.2 rows 1-3.
// All file text returned to the agent is wrapped in `{ untrusted_source }`
// (I-07, Spec 14.8). Paths are always re-validated against the workspace
// root (P2) regardless of what the model claims.

import path from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ok, fail, zodIssues } from "@pramaan/core";
import type { Result } from "@pramaan/core";
import type { AgentToolContext } from "./context.js";

const MAX_LIST_FILES = 200;
const MAX_READ_LINES = 400;
const MAX_SEARCH_MATCHES = 50;

/** Spec 14.8: detected instruction-like strings inside scanned files. */
const INJECTION_RE = /ignore (all|previous)|system:|you are now|mark .* verified/i;

function checkInjection(ctx: AgentToolContext, text: string, file: string): void {
  if (INJECTION_RE.test(text)) {
    const note = `INJECTION_SUSPECTED in ${file}`;
    ctx.injectionNotes.push(note);
    // Informational only (Spec 14.8): the protection is structural (I-01/
    // untrusted_source wrapping), not this detection. Still worth surfacing
    // in the trace for a human reviewer / UI to show.
    ctx.emit("tool.result", "engine", { observation: "INJECTION_SUSPECTED", file });
  }
}

function resolveWorkspacePath(ctx: AgentToolContext, relPath: string): { abs: string; rel: string } | null {
  const posix = relPath.split(path.sep).join("/");
  if (posix.split("/").some((seg) => seg === "..")) return null;
  if (path.posix.isAbsolute(posix) || /^[A-Za-z]:/.test(posix)) return null;
  const normalized = path.posix.normalize(posix);
  if (normalized.startsWith("..")) return null;
  const root = path.resolve(ctx.workspace.root);
  const resolved = path.resolve(root, normalized);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return { abs: resolved, rel: normalized };
}

function globToRegExp(glob: string): RegExp {
  let re = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(c as string)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  re += "$";
  return new RegExp(re);
}

const DEFAULT_EXCLUDES = new Set(["node_modules", "dist", ".pramaan", ".git"]);

async function walkAll(dir: string, base: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (DEFAULT_EXCLUDES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkAll(full, base, out);
    } else if (entry.isFile()) {
      out.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
}

// ---------- project.list_files ----------

export const listFilesSchema = z.object({ glob: z.string().optional() });

export async function listFilesHandler(input: unknown, ctx: AgentToolContext): Promise<Result<unknown>> {
  const parsed = listFilesSchema.safeParse(input);
  if (!parsed.success) return fail("E_BAD_INPUT", "invalid input for project.list_files", { issues: zodIssues(parsed.error) });

  const all: string[] = [];
  await walkAll(ctx.workspace.root, ctx.workspace.root, all);
  all.sort();

  const matcher = parsed.data.glob ? globToRegExp(parsed.data.glob) : null;
  const matched = matcher ? all.filter((f) => matcher.test(f)) : all;

  const files: { path: string; bytes: number; kind: string }[] = [];
  for (const rel of matched.slice(0, MAX_LIST_FILES)) {
    const abs = path.join(ctx.workspace.root, rel);
    const s = await stat(abs);
    files.push({ path: rel, bytes: s.size, kind: path.extname(rel).replace(/^\./, "") || "unknown" });
  }
  return ok({ files });
}

// ---------- source.read ----------

export const sourceReadSchema = z.object({
  path: z.string(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});

export async function sourceReadHandler(input: unknown, ctx: AgentToolContext): Promise<Result<unknown>> {
  const parsed = sourceReadSchema.safeParse(input);
  if (!parsed.success) return fail("E_BAD_INPUT", "invalid input for source.read", { issues: zodIssues(parsed.error) });

  const resolved = resolveWorkspacePath(ctx, parsed.data.path);
  if (!resolved) return fail("E_PATH_NOT_ALLOWED", `path "${parsed.data.path}" is not allowed`);

  let content: string;
  try {
    content = await readFile(resolved.abs, "utf-8");
  } catch {
    return fail("E_NOT_FOUND", `file "${parsed.data.path}" not found`);
  }

  checkInjection(ctx, content, resolved.rel);

  const allLines = content.split(/\r?\n/);
  const start = Math.max(1, parsed.data.startLine ?? 1);
  const requestedEnd = parsed.data.endLine ?? allLines.length;
  const end = Math.min(allLines.length, requestedEnd, start + MAX_READ_LINES - 1);

  const lines = [];
  for (let n = start; n <= end; n++) {
    lines.push({ n, text: allLines[n - 1] ?? "" });
  }

  const sha256 = createHash("sha256").update(content, "utf-8").digest("hex");

  return ok({
    untrusted_source: JSON.stringify({ path: resolved.rel, sha256, lines }),
  });
}

// ---------- source.search ----------

export const sourceSearchSchema = z.object({
  pattern: z.string(),
  glob: z.string().optional(),
});

export async function sourceSearchHandler(input: unknown, ctx: AgentToolContext): Promise<Result<unknown>> {
  const parsed = sourceSearchSchema.safeParse(input);
  if (!parsed.success) return fail("E_BAD_INPUT", "invalid input for source.search", { issues: zodIssues(parsed.error) });

  let re: RegExp;
  try {
    re = new RegExp(parsed.data.pattern);
  } catch (cause) {
    return fail("E_BAD_INPUT", `invalid regex pattern: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  const all: string[] = [];
  await walkAll(ctx.workspace.root, ctx.workspace.root, all);
  all.sort();
  const matcher = parsed.data.glob ? globToRegExp(parsed.data.glob) : null;
  const candidates = matcher ? all.filter((f) => matcher.test(f)) : all;

  const matches: { path: string; line: number; text: string }[] = [];
  for (const rel of candidates) {
    if (matches.length >= MAX_SEARCH_MATCHES) break;
    let content: string;
    try {
      content = await readFile(path.join(ctx.workspace.root, rel), "utf-8");
    } catch {
      continue;
    }
    checkInjection(ctx, content, rel);
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= MAX_SEARCH_MATCHES) break;
      const line = lines[i] as string;
      if (re.test(line)) {
        matches.push({ path: rel, line: i + 1, text: line });
      }
    }
  }

  return ok({
    untrusted_source: JSON.stringify({ matches }),
  });
}
