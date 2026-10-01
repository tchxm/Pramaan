import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AppShell from "../components/shell/AppShell.js";
import "../styles/demo.css";

type RecordData = {
  recordedAt: string;
  findings: Array<{ ruleId: string; pattern: string; location: { file: string; startLine: number } }>;
  remainingFindings: unknown[];
  patch: { diff: string };
  source: { before: string; after: string };
  verification: { verdict: string; gates: Array<{ gate: string; status: string }> };
};
const steps = ["The problem", "What PRAMAAN finds", "The bounded fix", "The engine checks"];
const explanations: Record<string, [string, string]> = {
  "PRM-001": ["Preselected extra", "Delivery Protection adds ₹49 before the shopper chooses it."],
  "PRM-002": ["False urgency", "The countdown is initialized locally and restarts when the page mounts."],
  "PRM-003": ["Unequal choices", "The accept and decline controls receive unequal visual treatment; review is required."],
  "PRM-004": ["Late fee disclosure", "A ₹39 handling fee first appears at payment, after the product and cart steps."],
};

export default function SavedDemo() {
  const [params, setParams] = useSearchParams();
  const requestedStep = Number(params.get("step") ?? "1");
  const step = Number.isInteger(requestedStep) && requestedStep >= 1 && requestedStep <= 4 ? requestedStep - 1 : 0;
  const setStep = (value: number) => setParams(value === 0 ? {} : { step: String(value + 1) }, { replace: true });
  const [record, setRecord] = useState<RecordData | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/demo/mitti-mart.json", { signal: controller.signal }).then(r => {
      if (!r.ok) throw Error("Example unavailable");
      return r.json();
    }).then(setRecord).catch(e => { if (e.name !== "AbortError") setError(true); });
    return () => controller.abort();
  }, []);
  return <div className="demo-page">
    <AppShell />
    <main className="demo-main">
      <Link className="demo-back" to="/">← Back to home</Link>
      <p className="demo-kicker">Saved demo · actual engine output · no API key needed</p>
      <h1>From a deceptive checkout<br />to a checked fix.</h1>
      <p className="demo-lede">PRAMAAN audits React source for dark patterns, lets an agent propose a limited change, and uses independent engine checks to decide whether the fix works. This saved example shows those checks on Mitti Mart, a sample coffee shop.</p>
      <nav className="demo-steps" aria-label="Demo steps">
        {steps.map((label, i) => <button key={label} aria-current={step === i ? "step" : undefined} onClick={() => setStep(i)}><span>0{i + 1}</span>{label}</button>)}
      </nav>
      <section className="demo-stage" aria-live="polite">
        <div className="demo-narration">
          <p className="demo-kicker">0{step + 1} / 04</p>
          <h2>{steps[step]}</h2>
          {step === 0 && <><p>A shopper wants coffee for ₹799. The cart silently selects ₹49 Delivery Protection, pressures them with a countdown, and reveals another fee later.</p><p>Give PRAMAAN the frontend project. It connects each finding to the source file and rule that triggered it.</p></>}
          {step === 1 && <><p>The real detector scan found four issues. Each has a source location, structural evidence, and a regulation reference in the downloadable record.</p><p>A finding is an audit signal, not a legal compliance certification.</p></>}
          {step === 2 && <><p>For the preselected extra, the engine generates a bounded patch: change the initial checkbox state from <code>true</code> to <code>false</code>.</p><p>The shopper can still choose protection. Its price and the checkout controls stay intact.</p></>}
          {step === 3 && <><p>The engine rebuilt the patched project, checked its browser behavior, and returned <strong>{record?.verification.verdict ?? "Loading recorded verdict…"}</strong> for this one fix.</p><p>Three other findings remain. This is a recorded engine example; it does not represent a live agent session or a fully cleared project.</p></>}
        </div>
        <div className="demo-output">
          {error ? <p role="alert">The saved example could not load. Reload this page to retry.</p> : !record ? <p role="status">Loading saved engine output…</p> : <>
            {step === 0 && <div className="demo-cart"><p className="demo-kicker">Mitti Mart · simplified checkout illustration</p><h3>Your basket</h3><div className="demo-price">Organic Coffee <b>₹799</b></div><p className="demo-countdown">Offer expires in 02:00</p><p className="demo-extra">☑ Delivery Protection <b>₹49</b></p><div className="demo-choice"><span>Yes, protect my order</span><small>No thanks</small></div><p className="demo-note">Recorded source: src/pages/Cart.tsx</p></div>}
            {step === 1 && <ol className="demo-findings">{record.findings.map(f => <li key={f.ruleId}><span className="demo-kicker">{f.ruleId} · {f.location.file}:{f.location.startLine}</span><h3>{explanations[f.ruleId]?.[0] ?? f.pattern}</h3><p>{explanations[f.ruleId]?.[1]}</p></li>)}</ol>}
            {step === 2 && <><p className="demo-kicker">Actual engine patch · Cart.tsx</p><pre className="demo-diff">{record.patch.diff}</pre><div className="demo-comparison"><div><span>Before</span><p>☑ Protection selected</p><code>useState(true)</code></div><div><span>After</span><p>☐ Shopper chooses</p><code>useState(false)</code></div></div></>}
            {step === 3 && <><p className="demo-verdict">{record.verification.verdict} <span>one finding</span></p><ul className="demo-gates">{record.verification.gates.map(g => <li key={g.gate}><span>{g.gate.replaceAll("_", " ")}</span><b>{g.status}</b></li>)}</ul><p className="demo-note">Recorded {new Date(record.recordedAt).toLocaleDateString()} · {record.remainingFindings.length} findings still open</p></>}
          </>}
        </div>
      </section>
      <div className="demo-controls"><button disabled={step === 0} onClick={() => setStep(step - 1)}>← Previous</button><span>{step + 1} of 4</span><button disabled={step === 3} onClick={() => setStep(step + 1)}>Next →</button></div>
      <section className="demo-files"><div><h2>Keep the example. Or run the engine.</h2><p>The saved files contain the original source, patched source, four findings, patch operations, and actual verification results. The guided run below shows four different stopping points in the workspace.</p></div><div className="demo-links"><a href="/demo/mitti-mart.json" download>Download saved audit JSON ↓</a><a href="/demo/cart-fix.patch" download>Download actual patch ↓</a><Link to="/audit?fixture=f06-mitti-mart&tour=1&demo=mixed">Run guided demo audit →</Link><small>Scripted decisions, real engine: one complete fix, one proposal-only stop, and two review-only stops. Requires the local API; no model key needed.</small><Link to="/audit?fixture=f06-mitti-mart&tour=1">Run a live demo audit →</Link><small>The live agent chooses its own actions and requires a configured provider.</small></div></section>
    </main>
  </div>;
}
