import { useRef, useState } from "react";
import { verifyEvidencePack, type VerifyPackResponse } from "../../api/client.js";
import "../../styles/workspace.css";

interface LoadedFiles {
  packName: string | null;
  pack: unknown | null;
  traceName: string | null;
  trace: string | null;
}

const EMPTY: LoadedFiles = { packName: null, pack: null, traceName: null, trace: null };

function looksLikeTraceFile(name: string): boolean {
  return /trace.*\.jsonl?$/i.test(name) || name.toLowerCase() === "trace.jsonl";
}

function PassIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M3 7.2 5.6 10 11 3.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FailIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <line x1="3.3" y1="3.3" x2="10.7" y2="10.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="10.7" y1="3.3" x2="3.3" y2="10.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * S5 "Verify a pack" — fully self-contained (no props), suitable as the
 * `/verify` route's entire content. Accepts evidence-pack.json by drag/drop
 * or file picker, and optionally trace.jsonl (dropped into the same zone;
 * distinguished by filename, per spec's "same drop target detecting
 * filename" option). Validates JSON shape locally before ever calling the
 * server, then calls verifyEvidencePack(pack, trace) from ../../api/client.
 */
export function PackVerifier(): JSX.Element {
  const [files, setFiles] = useState<LoadedFiles>(EMPTY);
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyPackResponse | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function ingest(fileList: FileList | null): Promise<void> {
    if (!fileList || fileList.length === 0) return;
    setLocalError(null);
    setResult(null);
    setApiError(null);

    let next = { ...files };
    for (const file of Array.from(fileList)) {
      const text = await file.text();
      if (looksLikeTraceFile(file.name)) {
        next = { ...next, traceName: file.name, trace: text };
        continue;
      }
      try {
        const parsed: unknown = JSON.parse(text);
        if (typeof parsed !== "object" || parsed === null) {
          throw new Error("not an object");
        }
        next = { ...next, packName: file.name, pack: parsed };
      } catch {
        setLocalError(`${file.name} isn't valid JSON. Expected evidence-pack.json.`);
        return;
      }
    }
    setFiles(next);
  }

  async function runVerify(): Promise<void> {
    if (!files.pack) return;
    setVerifying(true);
    setApiError(null);
    setResult(null);
    try {
      const res = await verifyEvidencePack(files.pack, files.trace ?? undefined);
      setResult(res);
    } catch (cause) {
      setApiError(cause instanceof Error ? cause.message : "Could not verify this pack.");
    } finally {
      setVerifying(false);
    }
  }

  function reset(): void {
    setFiles(EMPTY);
    setResult(null);
    setLocalError(null);
    setApiError(null);
  }

  const overallMessage = result
    ? result.valid
      ? "Pack is intact. Every check passed."
      : `Pack has been altered. Failed: ${result.checks
          .filter((c) => !c.pass)
          .map((c) => c.name)
          .join(", ")}.`
    : null;

  return (
    <div className="ws-pack-verifier">
      <h2 className="ws-pack-verifier__title">Verify a pack</h2>
      <p className="ws-pack-verifier__intro">
        Drop <span className="ws-mono">evidence-pack.json</span> (and optionally{" "}
        <span className="ws-mono">trace.jsonl</span>) to recompute every check independently.
      </p>

      <div
        className={`ws-pack-verifier__dropzone${dragOver ? " ws-pack-verifier__dropzone--active" : ""}`}
        data-testid="pack-dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void ingest(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        aria-label="Drop evidence-pack.json and optionally trace.jsonl, or press Enter to choose files"
      >
        <input
          ref={inputRef}
          type="file"
          accept=".json,.jsonl"
          multiple
          style={{ display: "none" }}
          onChange={(e) => void ingest(e.target.files)}
        />
        <p>Drop files here, or click to choose</p>
        <ul className="ws-pack-verifier__loaded">
          <li>{files.packName ? `Pack: ${files.packName}` : "Pack: none loaded"}</li>
          <li>{files.traceName ? `Trace: ${files.traceName}` : "Trace: none loaded (optional)"}</li>
        </ul>
      </div>

      {localError ? (
        <p className="ws-pack-verifier__error" role="alert">
          {localError}
        </p>
      ) : null}

      <div className="ws-pack-verifier__actions">
        <button
          type="button"
          className="ws-pack-verifier__verify-btn"
          disabled={!files.pack || verifying}
          onClick={() => void runVerify()}
        >
          {verifying ? "Verifying…" : "Verify pack"}
        </button>
        <button type="button" className="ws-pack-verifier__reset-btn" onClick={reset}>
          Clear
        </button>
      </div>

      {apiError ? (
        <p className="ws-pack-verifier__error" role="alert">
          {apiError}
        </p>
      ) : null}

      {result ? (
        <div className="ws-pack-verifier__result">
          <ul className="ws-pack-verifier__checks">
            {result.checks.map((check) => (
              <li
                key={check.name}
                className={`ws-pack-verifier__check ws-pack-verifier__check--${check.pass ? "pass" : "fail"}`}
              >
                <span className="ws-pack-verifier__check-icon">{check.pass ? <PassIcon /> : <FailIcon />}</span>
                <span className="ws-pack-verifier__check-name ws-mono">{check.name}</span>
                <span className="ws-pack-verifier__check-status">{check.pass ? "Pass" : "Fail"}</span>
                {check.detail ? <span className="ws-pack-verifier__check-detail">{check.detail}</span> : null}
              </li>
            ))}
          </ul>
          <p
            className={`ws-pack-verifier__overall ws-pack-verifier__overall--${result.valid ? "pass" : "fail"}`}
            role="status"
          >
            {overallMessage}
          </p>
        </div>
      ) : null}
    </div>
  );
}
