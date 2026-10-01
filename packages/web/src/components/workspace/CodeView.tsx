// CodeView — spec Section 18.4 / 18.9.
// Renders scanned source text with line numbers and highlighted line
// ranges. No syntax-highlighting library per spec 18.9 — this is a plain,
// monospaced, line-numbered view. `text` is untrusted scanned source
// (invariant I-07); it is rendered only through JSX text interpolation,
// which escapes it, never via dangerouslySetInnerHTML.
import { useMemo } from "react";
import "../../styles/workspace.css";

export interface CodeViewHighlightRange {
  startLine: number;
  endLine: number;
}

export interface CodeViewProps {
  file: string;
  text: string;
  highlight: CodeViewHighlightRange[];
}

function isHighlighted(lineNumber: number, ranges: CodeViewHighlightRange[]): boolean {
  for (const r of ranges) {
    if (lineNumber >= r.startLine && lineNumber <= r.endLine) return true;
  }
  return false;
}

export function CodeView({ file, text, highlight }: CodeViewProps): JSX.Element {
  const lines = useMemo(() => text.split("\n"), [text]);
  const gutterWidth = useMemo(() => String(lines.length).length, [lines.length]);

  return (
    <div className="ws-code-view" data-testid="code-view">
      <div className="ws-code-view__header ws-mono">{file}</div>
      <pre className="ws-code-view__body">
        <code>
          {lines.map((line, i) => {
            const lineNumber = i + 1;
            const active = isHighlighted(lineNumber, highlight);
            return (
              <div
                key={lineNumber}
                className={
                  active ? "ws-code-view__line ws-code-view__line--highlight" : "ws-code-view__line"
                }
              >
                <span
                  className="ws-code-view__gutter ws-mono"
                  style={{ minWidth: `${gutterWidth}ch` }}
                >
                  {lineNumber}
                </span>
                <span className="ws-code-view__text ws-mono">{line.length === 0 ? " " : line}</span>
              </div>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
