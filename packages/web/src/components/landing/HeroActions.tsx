import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const COPY_TEXT = "npx pramaan audit ./src";
const PILL_BASE =
  "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors duration-150 sm:px-5";

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="4.5" y="4.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

/**
 * Hero action pills. Every pill routes somewhere real via react-router's
 * useNavigate (spec Section 9.8) — none of them are dead buttons. The
 * "Watch the demo" / "See how verification works" pills use query-param
 * conventions on /audit since the audit-start screen (S1) that would
 * consume them doesn't exist yet in this pass:
 *   - ?fixture=f06-mitti-mart  -> intended to auto-select fixture F06
 *   - ?highlight=verification  -> intended to scroll/highlight the
 *     verification explanation once S1 exists
 * These are read by whoever builds S1; they're inert until then.
 */
export default function HeroActions() {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    <div
      className={`mt-8 flex flex-wrap gap-x-2 gap-y-1 transition-all duration-[0.4s] ${
        visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
    >
      <button
        type="button"
        onClick={() => navigate("/audit")}
        className={`${PILL_BASE} border-black/15 bg-white text-black hover:bg-black hover:text-white`}
      >
        Start an audit
      </button>

      <button
        type="button"
        onClick={() => navigate("/audit?fixture=f06-mitti-mart")}
        className={`${PILL_BASE} border-black/15 bg-white text-black hover:bg-black hover:text-white`}
      >
        Watch the demo
      </button>

      <button
        type="button"
        onClick={() => navigate("/audit?highlight=verification")}
        className={`${PILL_BASE} border-black/15 bg-white text-black hover:bg-black hover:text-white`}
      >
        See how verification works
      </button>

      <button
        type="button"
        onClick={() => navigate("/verify")}
        className={`${PILL_BASE} border-black/15 bg-white text-black hover:bg-black hover:text-white`}
      >
        Verify an evidence pack
      </button>

      <button
        type="button"
        onClick={handleCopy}
        className={`${PILL_BASE} border-white/40 bg-transparent text-white hover:bg-white hover:text-black`}
      >
        <CopyIcon />
        {copied ? "Copied!" : COPY_TEXT}
      </button>
    </div>
  );
}
