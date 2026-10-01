import { useCallback, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import MobileNavigation from "./MobileNavigation.js";

/**
 * Fixed top navigation for the landing page. Desktop shows the full nav +
 * CTA; below `md` it collapses to a hamburger that opens MobileNavigation.
 *
 * NOTE on "How it works" / "Documentation": neither an in-app explanation
 * screen nor a docs site exists yet. Both links scroll to the in-page
 * "#how-it-works" hero section (the blurred intro + typewriter copy) rather
 * than pointing at a route or URL that doesn't exist. See handoff notes.
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
    <header className="fixed inset-x-0 top-0 z-30 px-5 py-4 sm:px-8 sm:py-5">
      <div className="flex items-center justify-between">
        <Link
          to="/"
          className="[font-family:var(--font-heading)] text-lg tracking-tight text-white sm:text-xl"
          aria-label="PRAMAAN home"
        >
          PRAMAAN<span aria-hidden="true">✦</span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-8 text-sm text-white/85 md:flex">
          <a href="#how-it-works" className="transition-colors duration-150 hover:text-white">
            How it works
          </a>
          <Link to="/verify" className="transition-colors duration-150 hover:text-white">
            Evidence
          </Link>
          <a href="#how-it-works" className="transition-colors duration-150 hover:text-white">
            Documentation
          </a>
        </nav>

        <div className="hidden md:block">
          <Link
            to="/audit"
            className="inline-flex items-center rounded-full border border-black/15 bg-white px-5 py-2 text-sm text-black transition-colors duration-150 hover:bg-black hover:text-white"
          >
            Start an audit
          </Link>
        </div>

        <button
          ref={hamburgerRef}
          type="button"
          className="relative z-30 flex h-6 w-6 flex-col items-center justify-center gap-[5px] md:hidden"
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={mobileOpen}
          aria-controls={panelId}
          onClick={() => setMobileOpen((prev) => !prev)}
        >
          <span
            className="block h-[2px] w-6 bg-white transition-transform duration-300 ease-in-out"
            style={{ transform: mobileOpen ? "translateY(7px) rotate(45deg)" : "none" }}
          />
          <span
            className="block h-[2px] w-6 bg-white transition-opacity duration-300 ease-in-out"
            style={{ opacity: mobileOpen ? 0 : 1 }}
          />
          <span
            className="block h-[2px] w-6 bg-white transition-transform duration-300 ease-in-out"
            style={{ transform: mobileOpen ? "translateY(-7px) rotate(-45deg)" : "none" }}
          />
        </button>
      </div>

      <MobileNavigation id={panelId} open={mobileOpen} onClose={closeMobileNav} onNavigate={handleMobileNavigate} />
    </header>
  );
}
