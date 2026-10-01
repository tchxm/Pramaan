import { Suspense, lazy } from "react";
import { Routes, Route, Link } from "react-router-dom";
import LandingPage from "./components/landing/LandingPage.js";
import AppShell from "./components/shell/AppShell.js";

// Route-level code splitting per spec 18.9 (performance): the landing route
// stays eagerly bundled (it is "/", the first paint), the four screen routes
// are lazy — a judge who only ever sees the landing page pays nothing for
// S1-S5's JS.
const S1Start = lazy(() => import("./screens/S1Start.js"));
const S2Workspace = lazy(() => import("./screens/S2Workspace.js"));
const S4Outcome = lazy(() => import("./screens/S4Outcome.js"));
const S5Verify = lazy(() => import("./screens/S5Verify.js"));
const HowItWorks = lazy(() => import("./screens/HowItWorks.js"));
const DocsPage = lazy(() => import("./screens/DocsPage.js"));

// A deep link to an unknown route must not silently dump the user at Home
// (spec P0) — react-router renders nothing at all for an unmatched path
// with no catch-all, which reads as a worse bug than an honest 404.
function NotFound() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bench)", color: "var(--ink)" }}>
      <AppShell />
      <div style={{ padding: "96px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: "var(--font-heading)", fontWeight: 400 }}>Page not found</h1>
        <p style={{ color: "var(--slate)" }}>
          <Link to="/" style={{ color: "var(--link)" }}>
            Go home
          </Link>{" "}
          or{" "}
          <Link to="/audit" style={{ color: "var(--link)" }}>
            start an audit
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

function RouteFallback() {
  return <div style={{ padding: 24 }}>Loading…</div>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route
        path="/audit"
        element={
          <Suspense fallback={<RouteFallback />}>
            <S1Start />
          </Suspense>
        }
      />
      <Route
        path="/audit/:id"
        element={
          <Suspense fallback={<RouteFallback />}>
            <S2Workspace />
          </Suspense>
        }
      />
      <Route
        path="/audit/:id/outcome"
        element={
          <Suspense fallback={<RouteFallback />}>
            <S4Outcome />
          </Suspense>
        }
      />
      <Route
        path="/verify"
        element={
          <Suspense fallback={<RouteFallback />}>
            <S5Verify />
          </Suspense>
        }
      />
      <Route
        path="/how-it-works"
        element={
          <Suspense fallback={<RouteFallback />}>
            <HowItWorks />
          </Suspense>
        }
      />
      <Route
        path="/docs"
        element={
          <Suspense fallback={<RouteFallback />}>
            <DocsPage />
          </Suspense>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
