// Ties file discovery + jsx.ts + css.ts together into a full ProjectModel.
// Spec Section 9.1/9.2/9.4.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { hashFile } from "../workspace.js";
import type { PramaanConfig } from "../config.js";
import { discoverFiles } from "./discover.js";
import { parseJsxFile } from "./jsx.js";
import { parseCssFile } from "./css.js";
import type { FileModel, CssFileModel, ProjectModel } from "./model.js";

/** Builds a full ProjectModel by discovering files under `sourceRoot` +
 * `config.srcRoot`, parsing each with jsx.ts/css.ts, and hashing every file.
 * `sourceRoot` is an absolute path (typically a workspace root); all model
 * paths are POSIX-relative to it. */
export async function buildProjectModel(
  sourceRoot: string,
  config: PramaanConfig,
): Promise<ProjectModel> {
  const srcRootAbs = path.join(sourceRoot, config.srcRoot);
  const { jsFiles, cssFiles } = await discoverFiles(srcRootAbs, sourceRoot);

  const warnings: ProjectModel["warnings"] = [];
  const files: FileModel[] = [];
  for (const rel of jsFiles) {
    const abs = path.join(sourceRoot, rel);
    const source = await readFile(abs, "utf-8");
    const sha256 = await hashFile(abs);
    const { components, parseError } = parseJsxFile(rel, source);
    if (parseError) {
      warnings.push({ code: "E_PARSE_ERROR", message: parseError.message, file: rel });
    }
    files.push({ path: rel, sha256, source, components, ...(parseError ? { parseError } : {}) });
  }

  const cssModels: CssFileModel[] = [];
  for (const rel of cssFiles) {
    const abs = path.join(sourceRoot, rel);
    const source = await readFile(abs, "utf-8");
    const sha256 = await hashFile(abs);
    const { model, parseError } = parseCssFile(rel, source);
    if (parseError) {
      warnings.push({ code: "E_PARSE_ERROR", message: parseError.message, file: rel });
      continue;
    }
    cssModels.push({ ...model, sha256 });
  }

  return { srcRoot: config.srcRoot, files, cssFiles: cssModels, warnings };
}
