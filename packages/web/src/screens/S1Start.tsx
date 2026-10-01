// S1 Start — spec Section 18.3. "Audit a frontend project": pick a fixture,
// set options, start an audit, land on S2 Workspace. Never computes
// findings; only reads fixtures from the server and asks it to start a run.
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  getFixtures,
  createAudit,
  ApiError,
  API_BASE_URL,
  type FixtureSummary,
} from "../api/client.js";
import { ErrorState } from "../components/workspace/ErrorState.js";
import "../styles/workspace.css";
import "../styles/screens.css";

// Spec 3.4 / 18.6, verbatim. Imported from "@pramaan/core/constants" rather
// than the package's main "@pramaan/core" entry — that barrel re-exports the
// whole detector/patch/verify engine (including Playwright), which a browser
// bundler can't resolve and would blow the 300 KB budget in 18.9 anyway.
// "./constants" is a dedicated, dependency-free subpath exposed in
// packages/core/package.json's "exports" map for exactly this purpose.
import { DISCLAIMER } from "@pramaan/core/constants";

type LoadState = "loading" | "ready" | "error";

export default function S1Start(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [fixtures, setFixtures] = useState<FixtureSummary[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runtime, setRuntime] = useState(true);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [autoApprovePreview, setAutoApprovePreview] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const requestedFixture = searchParams.get("fixture");
  const tour = searchParams.get("tour") === "1";
  const autoStartedRef = useRef(false);

  const load = (): void => {
    setLoadState("loading");
    setError(null);
    getFixtures()
      .then((list) => {
        setFixtures(list);
        setLoadState("ready");
        setSelectedId((current) => {
          if (current) return current;
          if (requestedFixture && list.some((f) => f.id === requestedFixture)) {
            return requestedFixture;
          }
          return list[0]?.id ?? null;
        });
      })
      .catch((err: unknown) => {
        const code = err instanceof ApiError ? err.code : "E_INTERNAL";
        const message = err instanceof ApiError ? err.message : "Could not load fixtures.";
        setError({ code, message });
        setLoadState("error");
      });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const onStart = (): void => {
    if (!selectedId || starting) return;
    setStarting(true);
    setStartError(null);
    createAudit(
      { type: "fixture", id: selectedId },
      { runtime, maxAttempts, autoApprovePreview },
    )
      .then(({ auditId }) => {
        navigate(tour ? `/audit/${auditId}?tour=1` : `/audit/${auditId}`);
      })
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : "Could not start the audit.";
        setStartError(message);
        setStarting(false);
      });
  };

  // "Watch the demo" (?tour=1) auto-starts the audit once the requested
  // fixture is loaded and selected, so a judge sees the real workspace
  // immediately instead of having to click Start themselves.
  useEffect(() => {
    if (!tour || autoStartedRef.current) return;
    if (loadState !== "ready" || !selectedId) return;
    if (requestedFixture && selectedId !== requestedFixture) return;
    autoStartedRef.current = true;
    onStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour, loadState, selectedId, requestedFixture]);

  if (loadState === "error" && error) {
    return (
      <div className="scr-page scr-page--center">
        <ErrorState
          code={error.code}
          message={
            error.code === "E_SERVER_UNREACHABLE"
              ? `The server isn't reachable at ${API_BASE_URL}. Start it with \`npm run demo\`, then reload.`
              : error.message
          }
          action={{ label: "Retry", onClick: load }}
        />
      </div>
    );
  }

  return (
    <div className="scr-page">
      <header className="scr-start-header">
        <h1 className="scr-headline">Audit a frontend project</h1>
      </header>

      <div className="scr-start-grid">
        <section className="scr-panel" aria-labelledby="scr-fixtures-heading">
          <h2 id="scr-fixtures-heading" className="scr-panel-title">
            Fixtures
          </h2>
          {loadState === "loading" ? (
            <div className="scr-skeleton-list">
              <div className="scr-skeleton-row" />
              <div className="scr-skeleton-row" />
              <div className="scr-skeleton-row" />
            </div>
          ) : (
            <table className="scr-fixture-table">
              <thead>
                <tr>
                  <th scope="col" aria-hidden="true" />
                  <th scope="col">Name</th>
                  <th scope="col">Expected findings</th>
                  <th scope="col">Description</th>
                </tr>
              </thead>
              <tbody>
                {fixtures.map((fixture) => {
                  const count = fixture.expected.findings.reduce((sum, f) => sum + f.count, 0);
                  const selected = fixture.id === selectedId;
                  return (
                    <tr
                      key={fixture.id}
                      className={selected ? "scr-fixture-row scr-fixture-row--selected" : "scr-fixture-row"}
                      onClick={() => setSelectedId(fixture.id)}
                    >
                      <td>
                        <input
                          type="radio"
                          name="fixture"
                          checked={selected}
                          onChange={() => setSelectedId(fixture.id)}
                          aria-label={`Select fixture ${fixture.name}`}
                        />
                      </td>
                      <td className="ws-mono">{fixture.name}</td>
                      <td>{count}</td>
                      <td className="scr-fixture-desc">{fixture.description}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="scr-panel" aria-labelledby="scr-options-heading">
          <h2 id="scr-options-heading" className="scr-panel-title">
            Options
          </h2>

          <label className="scr-option-row">
            <input
              type="checkbox"
              checked={runtime}
              onChange={(e) => setRuntime(e.target.checked)}
            />
            <span>Runtime checks</span>
          </label>

          <label className="scr-option-row">
            <span>Max attempts</span>
            <input
              type="number"
              className="scr-number-input"
              min={1}
              max={5}
              value={maxAttempts}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) setMaxAttempts(Math.min(5, Math.max(1, n)));
              }}
            />
          </label>

          <label className="scr-option-row">
            <input
              type="checkbox"
              checked={autoApprovePreview}
              onChange={(e) => setAutoApprovePreview(e.target.checked)}
            />
            <span>Auto-approve previews</span>
          </label>

          <button
            type="button"
            className="scr-primary-btn"
            disabled={!selectedId || starting || loadState !== "ready"}
            onClick={onStart}
          >
            {starting ? "Starting audit…" : "Start audit"}
          </button>

          {startError ? <p className="scr-inline-error">{startError}</p> : null}
        </section>
      </div>

      <p className="scr-disclaimer">{DISCLAIMER}</p>
    </div>
  );
}
