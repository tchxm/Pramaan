import { useEffect, useRef } from "react";

interface MobileNavigationProps {
  id: string;
  open: boolean;
  onClose: () => void;
  onNavigate: (to: string) => void;
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Full-viewport mobile nav overlay. Real <button>s, aria-expanded /
 * aria-controls (wired by the caller via `id`), Escape-to-close, a focus
 * trap while open, body scroll lock, and returning focus to the hamburger
 * on close (the caller owns that last step since it owns the button ref).
 */
export default function MobileNavigation({ id, open, onClose, onNavigate }: MobileNavigationProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    // Prevent keyboard/AT focus from landing on links hidden behind the
    // overlay's opacity/pointer-events transition when closed.
    (panel as HTMLDivElement & { inert?: boolean }).inert = !open;

    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const initiallyFocusable = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    initiallyFocusable[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;

      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  return (
    <div
      id={id}
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Site navigation"
      aria-hidden={!open}
      className={`lp-mobile-nav${open ? " lp-mobile-nav--open" : ""}`}
    >
      <button type="button" onClick={() => onNavigate("/how-it-works")}>
        How it works
      </button>
      <button type="button" onClick={() => onNavigate("/verify")}>
        Evidence
      </button>
      {/* No docs site exists yet; scroll to the in-page explanation instead
          of linking to a fabricated external URL. */}
      <a href="#how-it-works" onClick={onClose}>
        Documentation
      </a>
      <button type="button" className="lp-mobile-nav__cta" onClick={() => onNavigate("/audit")}>
        Start an audit
      </button>
    </div>
  );
}
