import { EvidenceTag } from "./EvidenceTag";
import "../../styles/workspace.css";

export interface FileTreeFile {
  path: string;
  findingIds: string[];
}

export interface FileTreeProps {
  files: FileTreeFile[];
  selected?: string;
  onSelect: (path: string) => void;
}

/**
 * Flat list of scanned files as rows (spec rejects grids of identical
 * cards; tables/lists are the device here). Each row shows the file path
 * in monospace plus an evidence tag per finding in that file, up to 3
 * shown inline with a "+n" overflow marker.
 */
export function FileTree({ files, selected, onSelect }: FileTreeProps): JSX.Element {
  if (files.length === 0) {
    return <p className="ws-file-tree__empty">No files scanned yet.</p>;
  }

  return (
    <div className="ws-file-tree" role="list">
      {files.map((f) => {
        const isSelected = f.path === selected;
        const shown = f.findingIds.slice(0, 3);
        const overflow = f.findingIds.length - shown.length;
        return (
          <button
            key={f.path}
            type="button"
            role="listitem"
            className={`ws-file-tree__row${isSelected ? " ws-file-tree__row--selected" : ""}`}
            aria-current={isSelected ? "true" : undefined}
            onClick={() => onSelect(f.path)}
          >
            <span className="ws-file-tree__path ws-mono">{f.path}</span>
            {f.findingIds.length > 0 ? (
              <span className="ws-file-tree__tags">
                {shown.map((id, i) => (
                  <EvidenceTag key={id} index={i + 1} />
                ))}
                {overflow > 0 ? (
                  <span className="ws-mono" style={{ fontSize: 12, color: "var(--slate)" }}>
                    +{overflow}
                  </span>
                ) : null}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
