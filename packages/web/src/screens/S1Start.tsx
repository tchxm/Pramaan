// S1 Start — spec Section 16. Rebuilt away from "raw fixture table as the
// primary UI" (it read as a developer test-runner, not a product) into two
// real choices: audit a real project by path (the server genuinely
// supports `{type:"path"}`, confined to its own filesystem — this is not
// a fabricated capability), or run the prepared Mitti Mart demo. Every
// other fixture is still reachable, just under "Advanced demo scenarios"
// rather than presented as the primary onboarding surface.
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
import AppShell from "../components/shell/AppShell.js";
import "../styles/workspace.css";
import "../styles/screens.css";
import { DISCLAIMER } from "@pramaan/core/constants";

type LoadState = "loading" | "ready" | "error";

const FEATURED_FIXTURE_ID = "f06-mitti-mart";

function findingCount(fixture: FixtureSummary): number {
  return fixture.expected.findings.reduce((sum, f) => sum + f.count, 0);
}

export default function S1Start(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [fixtures, setFixtures] = useState<FixtureSummary[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  const [projectPath, setProjectPath] = useState("");
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null);
  const [runtime, setRuntime] = useState(true);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [autoApprovePreview, setAutoApprovePreview] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
        if (requestedFixture && list.some((f) => f.id === requestedFixture)) {
          setSelectedFixtureId(requestedFixture);
        }
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

  const startFixture = (fixtureId: string, useTour: boolean): void => {
    if (starting) return;
    setStarting(true);
    setStartError(null);
    createAudit({ type: "fixture", id: fixtureId }, { runtime, maxAttempts, autoApprovePreview })
      .then(({ auditId }) => {
        navigate(useTour ? `/audit/${auditId}?tour=1` : `/audit/${auditId}`);
      })
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : "Could not start the audit.";
        setStartError(message);
        setStarting(false);
      });
  };

  const startPath = (): void => {
    if (!projectPath.trim() || starting) return;
    setStarting(true);
    setStartError(null);
    createAudit({ type: "path", path: projectPath.trim() }, { runtime, maxAttempts, autoApprovePreview })
      .then(({ auditId }) => navigate(`/audit/${auditId}`))
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : "Could not start the audit.";
        setStartError(message);
        setStarting(false);
      });
  };

  // "Watch the demo" (?tour=1&fixture=f06-mitti-mart) auto-starts once
  // fixtures are loaded, so a judge sees the real workspace immediately.
  useEffect(() => {
    if (!tour || autoStartedRef.current) return;
    if (loadState !== "ready") return;
    const fixtureId = requestedFixture ?? FEATURED_FIXTURE_ID;
    if (!fixtures.some((f) => f.id === fixtureId)) return;
    autoStartedRef.current = true;
    startFixture(fixtureId, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour, loadState, fixtures, requestedFixture]);

  if (loadState === "error" && error) {
    return (
      <div className="scr-page scr-page--center">
        <AppShell />
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

  const featured = fixtures.find((f) => f.id === FEATURED_FIXTURE_ID);
  const otherFixtures = fixtures.filter((f) => f.id !== FEATURED_FIXTURE_ID);

  return (
    <div className="scr-page">
      <AppShell />

      <header className="scr-start-hero">
        <p className="scr-start-eyebrow">Start an audit</p>
        <h1 className="scr-headline">Give PRAMAAN a frontend.</h1>
        <p className="scr-start-lede">
          It will detect deceptive patterns, investigate, propose bounded fixes, and verify every
          change with the same deterministic engine that found the problem.
        </p>
      </header>

      <div className="scr-start-choices">
        <section className="scr-start-card" aria-labelledby="scr-path-heading">
          <p className="scr-start-card__label">A</p>
          <h2 id="scr-path-heading" className="scr-start-card__title">
            Audit a project
          </h2>
          <p className="scr-start-card__dek">
            Enter a path to a frontend project on this machine (relative to the server, e.g.{" "}
            <code>./my-app</code>).
          </p>
          <input
            type="text"
            className="scr-path-input"
            placeholder="./path/to/project"
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
            aria-label="Project path"
          />
          <button
            type="button"
            className="scr-primary-btn"
            disabled={!projectPath.trim() || starting || loadState !== "ready"}
            onClick={startPath}
          >
            {starting ? "Starting audit…" : "Audit this project"}
          </button>
        </section>

        <section className="scr-start-card scr-start-card--featured" aria-labelledby="scr-demo-heading">
          <p className="scr-start-card__label">B</p>
          <h2 id="scr-demo-heading" className="scr-start-card__title">
            Try the prepared demo
          </h2>
          {loadState === "loading" ? (
            <div className="scr-skeleton-list">
              <div className="scr-skeleton-row" />
              <div className="scr-skeleton-row" />
            </div>
          ) : (
            <>
              <p className="scr-demo-name">Mitti Mart</p>
              <p className="scr-start-card__dek">Full PRAMAAN demonstration</p>
              <ul className="scr-demo-facts">
                <li>{featured ? findingCount(featured) : 4} deterministic findings</li>
                <li>agent remediation</li>
                <li>G1–G5 verification</li>
                <li>evidence pack</li>
              </ul>
              <button
                type="button"
                className="scr-primary-btn"
                disabled={starting || loadState !== "ready"}
                onClick={() => startFixture(FEATURED_FIXTURE_ID, true)}
              >
                {starting ? "Starting audit…" : "Run demo audit →"}
              </button>
            </>
          )}
        </section>
      </div>

      <section className="scr-start-options" aria-labelledby="scr-options-heading">
        <h2 id="scr-options-heading" className="scr-panel-title">
          Options
        </h2>
        <label className="scr-option-row">
          <input type="checkbox" checked={runtime} onChange={(e) => setRuntime(e.target.checked)} />
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
        {startError ? <p className="scr-inline-error">{startError}</p> : null}
      </section>

      <details className="scr-advanced" open={advancedOpen} onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}>
        <summary>Advanced demo scenarios</summary>
        {loadState === "loading" ? (
          <div className="scr-skeleton-list">
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
              {otherFixtures.map((fixture) => {
                const selected = fixture.id === selectedFixtureId;
                return (
                  <tr
                    key={fixture.id}
                    className={selected ? "scr-fixture-row scr-fixture-row--selected" : "scr-fixture-row"}
                    onClick={() => setSelectedFixtureId(fixture.id)}
                  >
                    <td>
                      <input
                        type="radio"
                        name="fixture"
                        checked={selected}
                        onChange={() => setSelectedFixtureId(fixture.id)}
                        aria-label={`Select fixture ${fixture.name}`}
                      />
                    </td>
                    <td className="ws-mono">{fixture.name}</td>
                    <td>{findingCount(fixture)}</td>
                    <td className="scr-fixture-desc">{fixture.description}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <button
          type="button"
          className="scr-primary-btn scr-advanced__start"
          disabled={!selectedFixtureId || starting || loadState !== "ready"}
          onClick={() => selectedFixtureId && startFixture(selectedFixtureId, false)}
        >
          {starting ? "Starting audit…" : "Start audit"}
        </button>
      </details>

      <p className="scr-disclaimer">{DISCLAIMER}</p>
    </div>
  );
}
