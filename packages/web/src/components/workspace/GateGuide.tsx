import "../../styles/checkout.css";

export const gateDescriptions = [
  ["G1", "The targeted pattern is gone", "Run the detector again against the patched source."],
  ["G2", "Protected values are preserved", "Check the protected source values, including prices and required text."],
  ["G3", "The project still builds", "Build the patched project; a proposed edit alone is not enough."],
  ["G4", "Browser behavior is checked", "Run the rule’s browser assertions. Skipped runtime checks are never shown as a pass."],
  ["G5", "No new findings are introduced", "Compare the detector results against the original scan."],
];

export default function GateGuide() {
  return <details className="judge-gate-guide"><summary>What do the five independent checks prove?</summary><ol>{gateDescriptions.map(([id, title, explanation]) => <li key={id}><strong>{id} · {title}</strong><br />{explanation}</li>)}</ol><p>A verified finding is a checked fix within the supported rules, not a legal certification of the entire project.</p></details>;
}
