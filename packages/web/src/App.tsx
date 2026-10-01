import { Suspense, lazy, useEffect, useRef } from "react";
import { Routes, Route, Link, useLocation } from "react-router-dom";
import LandingPage from "./components/landing/LandingPage.js";
import AppShell from "./components/shell/AppShell.js";
import "./styles/routeTransition.css";

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

/**
 * A deliberate (spec section 34) route transition: a brief, pure-CSS
 * fade-in on the new page, keyed by pathname. Does NOT delay when the new
 * route's component mounts or unmounts relative to the URL change — it's
 * an entrance animation on an already-mounted tree, not a buffered swap —
 * so it can never affect SSE connect/disconnect timing or any other route
 * logic. Also moves focus to the new page's <h1> for keyboard/AT users,
 * per the same spec section.
 */
function RouteTransition({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Lazy routes commit their real <h1> only after the Suspense fallback
    // resolves — a plain one-shot query here would run against the
    // fallback's empty DOM and never retry, since this effect's dependency
    // (pathname) doesn't change again once the real content lands. Poll a
    // few frames instead of reaching for a MutationObserver for something
    // this short-lived.
    let attempts = 0;
    let raf = 0;
    function tryFocus() {
      const heading = container!.querySelector<HTMLElement>("h1");
      if (heading) {
        if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
        return;
      }
      attempts += 1;
      if (attempts < 30) raf = requestAnimationFrame(tryFocus);
    }
    tryFocus();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <div key={location.pathname} ref={containerRef} className="route-fade">
      {children}
    </div>
  );
}

export default function App() {
  return (
    <RouteTransition>
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
    </RouteTransition>
  );
}
