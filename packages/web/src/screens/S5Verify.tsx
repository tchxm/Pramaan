// S5 Verify a pack — spec Section 18.3. Trivial page wrapper; PackVerifier
// is self-contained (drop zone, checks list, overall pass/fail statement).
import { PackVerifier } from "../components/workspace/PackVerifier.js";
import "../styles/workspace.css";
import "../styles/screens.css";

export default function S5Verify(): JSX.Element {
  return (
    <div className="scr-page">
      <h1 className="scr-headline">Verify an evidence pack</h1>
      <p className="scr-subhead">
        Drop an evidence-pack.json (and optionally trace.jsonl) to check it against its recorded hashes.
      </p>
      <PackVerifier />
    </div>
  );
}
