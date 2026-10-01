import { useState } from "react";
import "../../styles/workspace.css";

export interface ProofBlockProps {
  auditId: string;
  evidenceHash: string;
  traceHead: string;
  reportUrl: string;
  packUrl: string;
}

interface Row {
  label: string;
  value: string;
  mono: boolean;
}

function truncate(value: string, head = 10, tail = 6): string {
  return value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
}

function CopyButton({ value }: { value: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API may be unavailable (insecure context, permissions);
      // the full value is still visible via the title attribute.
    }
  }
  return (
    <button type="button" className="ws-proof-block__copy" onClick={() => void copy()}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * S4 proof block — the four pieces of evidence identity for this audit, laid
 * out so a judge can verify them independently. Hashes are truncated for
 * scannability but the full value is always available via `title` and a
 * copy button; never truncated-only.
 */
export function ProofBlock({ auditId, evidenceHash, traceHead, reportUrl, packUrl }: ProofBlockProps): JSX.Element {
  const rows: Row[] = [
    { label: "Audit ID", value: auditId, mono: true },
    { label: "Evidence hash", value: evidenceHash, mono: true },
    { label: "Trace head", value: traceHead, mono: true },
  ];

  return (
    <div className="ws-proof-block">
      <dl className="ws-proof-block__rows">
        {rows.map((row) => (
          <div className="ws-proof-block__row" key={row.label}>
            <dt>{row.label}</dt>
            <dd>
              <span className={row.mono ? "ws-mono" : undefined} title={row.value}>
                {truncate(row.value)}
              </span>
              <CopyButton value={row.value} />
            </dd>
          </div>
        ))}
      </dl>
      <div className="ws-proof-block__links">
        <a className="ws-proof-block__link" href={reportUrl} data-testid="open-report-link">
          Open evidence report
        </a>
        <a className="ws-proof-block__link" href={packUrl} download>
          Download evidence pack
        </a>
        {/* Links to the standalone S5 verifier (App.tsx's /verify route);
            PackVerifier takes no props, so no state needs to travel here. */}
        <a className="ws-proof-block__link ws-proof-block__link--primary" href="/verify" data-testid="verify-pack-link">
          Verify this pack
        </a>
      </div>
    </div>
  );
}
