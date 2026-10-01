import { useEffect, useRef } from "react";

interface MobileNavigationProps {
  id: string;
  open: boolean;
  onClose: () => void;
  onNavigate: (to: string) => void;
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Full-viewport mobile nav overlay. Handles the full accessibility
 * checklist from spec Section 9.5: real <button>s, aria-expanded /
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
      className={`fixed inset-0 z-40 flex flex-col items-start justify-center gap-7 bg-black/90 px-8 backdrop-blur-[8px] transition-opacity duration-300 md:hidden ${
        open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <a
        href="#how-it-works"
        onClick={onClose}
        className="text-2xl text-white [font-family:var(--font-heading)]"
      >
        How it works
      </a>
      <button
        type="button"
        onClick={() => onNavigate("/verify")}
        className="text-left text-2xl text-white [font-family:var(--font-heading)]"
      >
        Evidence
      </button>
      {/* No docs site exists yet; scroll to the in-page explanation instead
          of linking to a fabricated external URL. */}
      <a
        href="#how-it-works"
        onClick={onClose}
        className="text-2xl text-white [font-family:var(--font-heading)]"
      >
        Documentation
      </a>
      <button
        type="button"
        onClick={() => onNavigate("/audit")}
        className="mt-4 text-left text-2xl text-white [font-family:var(--font-heading)]"
      >
        Start an audit
      </button>
    </div>
  );
}
