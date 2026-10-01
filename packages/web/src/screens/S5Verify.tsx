// S5 Verify a pack — spec Section 18.3 / 28. PackVerifier is self-contained
// (drop zone, checks list, overall pass/fail statement); this screen just
// gives it the shared app shell (it previously had no header at all) and a
// two-column layout so the page doesn't read as one small card adrift in a
// mostly-empty viewport.
import { PackVerifier } from "../components/workspace/PackVerifier.js";
import AppShell from "../components/shell/AppShell.js";
import "../styles/workspace.css";
import "../styles/screens.css";

export default function S5Verify(): JSX.Element {
  return (
    <div className="scr-page">
      <AppShell />
      <div className="scr-verify-layout">
        <div className="scr-verify-intro">
          <h1 className="scr-headline">Verify an evidence pack</h1>
          <p className="scr-subhead">
            Recompute the recorded checks locally and detect whether the pack was altered. Drop an
            evidence-pack.json (and optionally trace.jsonl) to check it against its recorded hashes.
          </p>
        </div>
        <PackVerifier />
      </div>
    </div>
  );
}
