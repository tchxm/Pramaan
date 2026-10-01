import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const COPY_TEXT = "npx pramaan audit ./src";

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <rect x="4.5" y="4.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

/**
 * Hero action pills. Every pill routes somewhere real via react-router's
 * useNavigate — none are dead buttons. "Watch the demo" / "See how
 * verification works" use query-param conventions on /audit:
 *   - ?fixture=f06-mitti-mart  -> auto-selects fixture F06
 *   - ?highlight=verification  -> intended to scroll/highlight the
 *     verification explanation once S1 supports it
 */
export default function HeroActions() {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const prefersReducedMotion =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      setVisible(true);
      return;
    }

    const timer = window.setTimeout(() => setVisible(true), 400);
    return () => window.clearTimeout(timer);
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(COPY_TEXT);
      setCopied(true);
    } catch {
      // Clipboard API can be unavailable (insecure context, denied
      // permission, unsupported browser). Fail silently — no crash, no
      // console error — and simply skip the "Copied!" feedback.
      setCopied(false);
      return;
    }
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={`lp-actions${visible ? " lp-actions--visible" : ""}`}>
      <button type="button" onClick={() => navigate("/audit")} className="lp-pill lp-pill--primary">
        Start an audit
      </button>

      <button type="button" onClick={() => navigate("/audit?fixture=f06-mitti-mart")} className="lp-pill">
        Watch the demo
      </button>

      <button type="button" onClick={() => navigate("/audit?highlight=verification")} className="lp-pill">
        See how verification works
      </button>

      <button type="button" onClick={() => navigate("/verify")} className="lp-pill">
        Verify an evidence pack
      </button>

      <button type="button" onClick={handleCopy} className="lp-pill lp-pill--ghost">
        <CopyIcon />
        {copied ? "Copied!" : COPY_TEXT}
      </button>
    </div>
  );
}
