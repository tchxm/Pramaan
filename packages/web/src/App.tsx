import { Routes, Route } from "react-router-dom";
import LandingPage from "./components/landing/LandingPage.js";

function Placeholder({ name }: { name: string }) {
  return <div style={{ padding: 24 }}>{name} — not implemented yet.</div>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/audit" element={<Placeholder name="Start audit (S1)" />} />
      <Route path="/audit/:id" element={<Placeholder name="Workspace (S2)" />} />
      <Route path="/audit/:id/outcome" element={<Placeholder name="Outcome (S4)" />} />
      <Route path="/verify" element={<Placeholder name="Pack verifier (S5)" />} />
    </Routes>
  );
}
