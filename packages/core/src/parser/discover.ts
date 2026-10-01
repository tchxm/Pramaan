// File discovery — Spec Section 9.1.
// Scans config.srcRoot (default "src"), includes .tsx .ts .jsx .js .css,
// excludes node_modules/dist/.pramaan and *.test.*/*.spec.* files.
// Returns POSIX-relative paths, ready to feed into jsx.ts/css.ts.

import { readdir } from "node:fs/promises";
import path from "node:path";

const DEFAULT_EXCLUDE_DIRS = new Set(["node_modules", "dist", ".pramaan", ".git"]);
const INCLUDE_EXT = new Set([".tsx", ".ts", ".jsx", ".js", ".css"]);
const TEST_FILE_RE = /\.(test|spec)\./;

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

async function walk(dir: string, base: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (DEFAULT_EXCLUDE_DIRS.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), base, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (!INCLUDE_EXT.has(ext)) continue;
    if (TEST_FILE_RE.test(entry.name)) continue;
    out.push(toPosix(path.relative(base, path.join(dir, entry.name))));
  }
}

export interface DiscoveredFiles {
  jsFiles: string[]; // .ts .tsx .js .jsx, POSIX-relative to srcRootAbs's base
  cssFiles: string[];
}

/** Discovers scannable files under `srcRootAbs`. Returned paths are
 * POSIX-relative to `baseAbs` (typically the workspace/project root, so that
 * ProjectModel.files[].path matches SourceLocation.file conventions). */
export async function discoverFiles(srcRootAbs: string, baseAbs: string): Promise<DiscoveredFiles> {
  const all: string[] = [];
  await walk(srcRootAbs, baseAbs, all);
  const jsFiles: string[] = [];
  const cssFiles: string[] = [];
  for (const rel of all) {
    if (rel.endsWith(".css")) cssFiles.push(rel);
    else jsFiles.push(rel);
  }
  jsFiles.sort();
  cssFiles.sort();
  return { jsFiles, cssFiles };
}
