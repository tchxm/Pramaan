import { useCallback, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import MobileNavigation from "./MobileNavigation.js";

/**
 * Fixed top navigation for the landing page. Desktop shows the full nav +
 * CTA; below the mobile breakpoint it collapses to a hamburger that opens
 * MobileNavigation.
 *
 * NOTE on "Documentation": no docs site exists yet, so that link still
 * scrolls to the in-page "#how-it-works" hero section rather than pointing
 * at a URL that doesn't exist. "How it works" itself routes to the real
 * /how-it-works page.
 */
export default function TopNavigation() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const panelId = useId();
  const hamburgerRef = useRef<HTMLButtonElement | null>(null);
  const navigate = useNavigate();

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

  return (
    <header className="lp-nav">
      <div className="lp-nav__row">
        <Link to="/" className="lp-brand" aria-label="PRAMAAN home">
          PRAMAAN<span aria-hidden="true">✦</span>
        </Link>

        <nav aria-label="Primary" className="lp-nav__links">
          <Link to="/how-it-works">How it works</Link>
          <Link to="/verify">Evidence</Link>
          <a href="#how-it-works">Documentation</a>
        </nav>

        <div className="lp-nav__cta">
          <Link to="/audit" className="lp-pill lp-pill--primary">
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
