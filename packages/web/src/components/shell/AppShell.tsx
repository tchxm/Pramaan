import { useCallback, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import MobileNavigation from "../landing/MobileNavigation.js";
import "../../styles/landing.css";
import "./appshell.css";

/**
 * One shared header for every product route (landing uses `variant=
 * "transparent"` over its hero canvas; every other screen uses the solid
 * default). Before this existed, five screens had five different header
 * treatments — landing's TopNavigation, how-it-works' own "hiw-topbar",
 * bare page titles on S1Start/S4Outcome, and no header at all on S5Verify
 * — which is exactly the "pages feel like unrelated websites" complaint.
 *
 * `status` is a real, truthful label — never a placeholder. Callers that
 * know the live connection/phase state (the workspace) compute and pass
 * it; everywhere else the default "ENGINE READY" is true on its own terms
 * (the deterministic detector doesn't depend on a live audit connection).
 */
export type EngineStatusLabel =
  | "ENGINE READY"
  | "ENGINE CONNECTED"
  | "AUDIT RUNNING"
  | "WAITING FOR AGENT"
  | "VERIFYING"
  | "EVIDENCE READY"
  | "RECONNECTING"
  | "AGENT UNAVAILABLE";

export type EngineStatusTone = "neutral" | "active" | "warn";

const STATUS_TONE: Record<EngineStatusLabel, EngineStatusTone> = {
  "ENGINE READY": "neutral",
  "ENGINE CONNECTED": "neutral",
  "AUDIT RUNNING": "active",
  "WAITING FOR AGENT": "active",
  VERIFYING: "active",
  "EVIDENCE READY": "active",
  RECONNECTING: "warn",
  "AGENT UNAVAILABLE": "warn",
};

const NAV_ITEMS: Array<{ to: string; label: string }> = [
  { to: "/audit", label: "Audit" },
  { to: "/how-it-works", label: "Method" },
  { to: "/verify", label: "Evidence" },
  { to: "/docs", label: "Docs" },
];

export interface AppShellProps {
  variant?: "solid" | "transparent";
  status?: EngineStatusLabel;
}

export default function AppShell({ variant = "solid", status = "ENGINE READY" }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const panelId = useId();
  const hamburgerRef = useRef<HTMLButtonElement | null>(null);

  const closeMobileNav = useCallback(() => {
    setMobileOpen(false);
    window.setTimeout(() => hamburgerRef.current?.focus(), 0);
  }, []);

  const handleMobileNavigate = useCallback(
    (to: string) => {
      setMobileOpen(false);
      navigate(to);
    },
    [navigate],
  );

  const tone = STATUS_TONE[status];

  return (
    <header className={`shell-nav${variant === "transparent" ? " shell-nav--transparent" : ""}`}>
      <div className="shell-nav__row">
        <Link to="/" className="lp-brand" aria-label="PRAMAAN home">
          PRAMAAN<span aria-hidden="true">✦</span>
        </Link>

        <nav aria-label="Primary" className="shell-nav__links">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              aria-current={location.pathname.startsWith(item.to) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="shell-nav__right">
          <span className="shell-status" data-tone={tone}>
            <span className="shell-status__dot" aria-hidden="true" />
            {status}
          </span>
          <Link to="/audit" className="lp-pill lp-pill--primary shell-nav__cta">
            Start an audit
          </Link>
        </div>

        <button
          ref={hamburgerRef}
          type="button"
          className="lp-hamburger"
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={mobileOpen}
          aria-controls={panelId}
          onClick={() => setMobileOpen((prev) => !prev)}
        >
          <span style={{ transform: mobileOpen ? "translateY(7px) rotate(45deg)" : "none" }} />
          <span style={{ opacity: mobileOpen ? 0 : 1 }} />
          <span style={{ transform: mobileOpen ? "translateY(-7px) rotate(-45deg)" : "none" }} />
        </button>
      </div>

      <MobileNavigation id={panelId} open={mobileOpen} onClose={closeMobileNav} onNavigate={handleMobileNavigate} />
    </header>
  );
}
