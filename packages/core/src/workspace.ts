import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, cp, readdir, stat, rm } from "node:fs/promises";
import path from "node:path";
import { createTwoFilesPatch } from "diff";

export interface WorkspaceFile {
  path: string; // POSIX-relative to workspace root
  sha256: string;
}

export interface Workspace {
  auditId: string;
  root: string; // absolute path to .pramaan/workspaces/<auditId>
  sourceRoot: string; // absolute path to the original project
  files: Map<string, WorkspaceFile>;
}

const DEFAULT_EXCLUDES = new Set(["node_modules", "dist", ".pramaan", ".git"]);
const INCLUDE_EXT = new Set([".tsx", ".ts", ".jsx", ".js", ".css"]);

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

async function walk(dir: string, base: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (DEFAULT_EXCLUDES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, base, out);
    } else if (entry.isFile()) {
      out.push(toPosix(path.relative(base, full)));
    }
  }
}

export async function hashFile(absPath: string): Promise<string> {
  const buf = await readFile(absPath);
  return createHash("sha256").update(buf).digest("hex");
}

export async function createWorkspace(
  sourceRoot: string,
  auditId: string,
  workdir = ".pramaan",
): Promise<Workspace> {
  const root = path.resolve(sourceRoot, workdir, "workspaces", auditId);
  await mkdir(root, { recursive: true });

  const allFiles: string[] = [];
  await walk(sourceRoot, sourceRoot, allFiles);

  const files = new Map<string, WorkspaceFile>();
  for (const rel of allFiles) {
    if (rel.startsWith(`${workdir}/`)) continue;
    const ext = path.extname(rel);
    const absSrc = path.join(sourceRoot, rel);
    const absDest = path.join(root, rel);
    await mkdir(path.dirname(absDest), { recursive: true });
    await cp(absSrc, absDest);
    if (INCLUDE_EXT.has(ext)) {
      files.set(rel, { path: rel, sha256: await hashFile(absDest) });
    }
  }

  return { auditId, root, sourceRoot, files };
}

export async function diffFiles(
  workspace: Workspace,
  relPath: string,
  beforeContent?: string,
): Promise<string> {
  const after = await readFile(path.join(workspace.root, relPath), "utf-8");
  const before = beforeContent ?? after;
  return createTwoFilesPatch(relPath, relPath, before, after, "before", "after");
}

export interface Snapshot {
  id: string;
  files: Map<string, string>; // relPath -> original content
}

export async function snapshotFiles(workspace: Workspace, relPaths: string[]): Promise<Snapshot> {
  const files = new Map<string, string>();
  for (const rel of relPaths) {
    files.set(rel, await readFile(path.join(workspace.root, rel), "utf-8"));
  }
  return { id: createHash("sha256").update(relPaths.join("|") + Date.now()).digest("hex").slice(0, 12), files };
}

export async function restoreSnapshot(workspace: Workspace, snapshot: Snapshot): Promise<void> {
  for (const [rel, content] of snapshot.files) {
    await writeFile(path.join(workspace.root, rel), content, "utf-8");
  }
}

export async function removeWorkspace(workspace: Workspace): Promise<void> {
  await rm(workspace.root, { recursive: true, force: true });
}

export async function pathExists(absPath: string): Promise<boolean> {
  try {
    await stat(absPath);
    return true;
  } catch {
    return false;
  }
}
