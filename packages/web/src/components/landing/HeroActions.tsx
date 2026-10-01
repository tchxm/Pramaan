import { useState } from "react";
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
 * useNavigate. "Watch the demo" opens the saved /demo walkthrough; its
 * live-run link consumes the /audit launch URL after starting a fixture.
 * "See how verification works" goes to the real /how-it-works#verification
 * deep section.
 */
export default function HeroActions() {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

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
    <div className="lp-actions lp-actions--visible">
      <button type="button" onClick={() => navigate("/audit")} className="lp-pill lp-pill--primary">
        Start an audit
      </button>

      <button type="button" onClick={() => navigate("/demo")} className="lp-pill">
        Watch the demo
      </button>

      <button type="button" onClick={() => window.dispatchEvent(new Event("pramaan:replay-intro"))} className="lp-pill lp-pill--ghost">
        Replay intro
      </button>

      <button type="button" onClick={() => navigate("/how-it-works#verification")} className="lp-pill">
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
