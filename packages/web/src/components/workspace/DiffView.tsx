// DiffView — spec Section 18.4 / 18.9. Own unified-diff renderer, no
// library. The expected input is exactly what `createTwoFilesPatch` from
// the `diff` npm package produces (see packages/core/src/workspace.ts and
// packages/server/src/routes/audits.ts), including the "Index: <file>",
// "===...", "--- <file>\tbefore", "+++ <file>\tafter" header lines before
// each hunk, and potentially several such file blocks concatenated with
// blank-line separators (the /diff endpoint joins per-file patches with
// "\n"). `unifiedDiff` is derived from scanned project source — untrusted
// per I-07 — and is only ever rendered through JSX text interpolation.
import { useMemo } from "react";
import "../../styles/workspace.css";

export type DiffLineKind = "add" | "del" | "context" | "hunk-header" | "no-newline";

export interface DiffLine {
  kind: DiffLineKind;
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  oldFile: string;
  newFile: string;
  hunks: DiffHunk[];
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLineNo = 0;
  let newLineNo = 0;

  const lines = text.split("\n");
  for (const rawLine of lines) {
    if (rawLine.startsWith("Index: ") || rawLine.startsWith("===")) {
      continue;
    }
    if (rawLine.startsWith("--- ")) {
      currentFile = { oldFile: rawLine.slice(4).split("\t")[0] ?? "", newFile: "", hunks: [] };
      currentHunk = null;
      files.push(currentFile);
      continue;
    }
    if (rawLine.startsWith("+++ ")) {
      if (currentFile) currentFile.newFile = rawLine.slice(4).split("\t")[0] ?? "";
      continue;
    }
    const hunkMatch = HUNK_HEADER_RE.exec(rawLine);
    if (hunkMatch) {
      if (!currentFile) {
        currentFile = { oldFile: "", newFile: "", hunks: [] };
        files.push(currentFile);
      }
      oldLineNo = Number(hunkMatch[1]);
      newLineNo = Number(hunkMatch[3]);
      currentHunk = { header: rawLine, lines: [] };
      currentFile.hunks.push(currentHunk);
      continue;
    }
    if (!currentHunk) {
      // Stray line outside any hunk (e.g. a trailing blank separator) — skip.
      continue;
    }
    if (rawLine.startsWith("+")) {
      currentHunk.lines.push({
        kind: "add",
        content: rawLine.slice(1),
        oldLineNo: null,
        newLineNo: newLineNo,
      });
      newLineNo += 1;
    } else if (rawLine.startsWith("-")) {
      currentHunk.lines.push({
        kind: "del",
        content: rawLine.slice(1),
        oldLineNo: oldLineNo,
        newLineNo: null,
      });
      oldLineNo += 1;
    } else if (rawLine.startsWith("\\ No newline")) {
      currentHunk.lines.push({ kind: "no-newline", content: rawLine, oldLineNo: null, newLineNo: null });
    } else if (rawLine.startsWith(" ") || rawLine === "") {
      currentHunk.lines.push({
        kind: "context",
        content: rawLine.startsWith(" ") ? rawLine.slice(1) : rawLine,
        oldLineNo: oldLineNo,
        newLineNo: newLineNo,
      });
      oldLineNo += 1;
      newLineNo += 1;
    }
    // Any other line shape (shouldn't occur for createTwoFilesPatch output)
    // is ignored rather than mis-rendered.
  }

  return files.filter((f) => f.hunks.length > 0);
}

export interface DiffViewProps {
  unifiedDiff: string;
}

export function DiffView({ unifiedDiff }: DiffViewProps): JSX.Element {
  const files = useMemo(() => parseUnifiedDiff(unifiedDiff), [unifiedDiff]);

  if (files.length === 0) {
    return (
      <div className="ws-diff-view ws-diff-view--empty" data-testid="diff-view">
        No changes to show.
      </div>
    );
  }

  return (
    <div className="ws-diff-view" data-testid="diff-view">
      {files.map((file, fileIndex) => (
        <div className="ws-diff-view__file" key={`${file.oldFile}-${fileIndex}`}>
          <div className="ws-diff-view__file-header ws-mono">{file.newFile || file.oldFile}</div>
          {file.hunks.map((hunk, hunkIndex) => (
            <div className="ws-diff-view__hunk" key={`${hunkIndex}-${hunk.header}`}>
              <div className="ws-diff-view__hunk-header ws-mono">{hunk.header}</div>
              <pre className="ws-diff-view__body">
                <code>
                  {hunk.lines.map((line, lineIndex) => (
                    <div
                      key={lineIndex}
                      className={`ws-diff-view__line ws-diff-view__line--${line.kind}`}
                    >
                      <span className="ws-diff-view__gutter ws-mono">
                        {line.oldLineNo ?? ""}
                      </span>
                      <span className="ws-diff-view__gutter ws-mono">
                        {line.newLineNo ?? ""}
                      </span>
                      <span className="ws-diff-view__marker ws-mono">
                        {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
                      </span>
                      <span className="ws-diff-view__text ws-mono">
                        {line.content.length === 0 ? " " : line.content}
                      </span>
                    </div>
                  ))}
                </code>
              </pre>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
