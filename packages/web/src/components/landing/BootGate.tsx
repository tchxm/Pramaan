import { useEffect, useRef, useState } from "react";
import BootRobot from "./BootRobot.js";

/**
 * A boot/entry ceremony before the hero reveals itself — every line is a
 * real, verifiable fact about this engine (detector count, gate count,
 * whitelisted patch-op count, providers), not flavor text. Dismissible by
 * click, Enter, or Escape; skipped entirely under prefers-reduced-motion.
 */
const BOOT_LINES = [
  "detector engine — 5 pattern types armed",
  "regulation reference — Consumer Protection (E-Commerce) Rules, 2020",
  "patch engine — 7 whitelisted operation kinds",
  "verification gates — G1–G5 armed",
  "evidence engine — SHA-256 hash chain",
  "agent providers — Anthropic · Gemini · Groq",
];

// Shown once per browser session, not once per mount — without this,
// pressing Back to "/" (or any re-render of LandingPage) remounts
// BootGate and replays the whole ceremony, which reads as a bug the
// instant a judge taps Back after looking at the workspace.
const SESSION_KEY = "pramaan:boot-shown";

function alreadyShownThisSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function markShown(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // sessionStorage unavailable (private mode, etc.) — gate just replays;
    // not worth failing the page over.
  }
}

export default function BootGate() {
  const [open, setOpen] = useState(() => !alreadyShownThisSession());
  const [closing, setClosing] = useState(false);
  const [entering, setEntering] = useState(false);
  const [flash, setFlash] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const reducedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    markShown();
    reducedRef.current =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedRef.current) {
      setOpen(false);
      return;
    }
    const timers: number[] = [];
    BOOT_LINES.forEach((line, i) => {
      timers.push(
        window.setTimeout(() => {
          setLines((prev) => [...prev, line]);
          if (i === BOOT_LINES.length - 1) {
            window.setTimeout(() => setReady(true), 200);
          }
        }, 220 * (i + 1)),
      );
    });
    return () => timers.forEach(window.clearTimeout);
  }, []);

  useEffect(() => {
    if (ready) buttonRef.current?.focus();
  }, [ready]);

  function dismiss() {
    if (entering || closing) return;
    // Robot-to-story handoff: dolly the robot's camera through its visor,
    // flash at the peak, then wipe the gate away — HeroStory's own scene is
    // already rendering underneath, so the flash is what sells the cut as
    // one continuous push rather than two unrelated 3D scenes swapping.
    setEntering(true);
    window.setTimeout(() => setFlash(true), 560);
    window.setTimeout(() => {
      setClosing(true);
      setFlash(false);
    }, 700);
    window.setTimeout(() => setOpen(false), 1120);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closing, entering]);

  if (!open) return null;

  return (
    <div
      className={`lp-gate${closing ? " lp-gate--closing" : ""}${entering ? " lp-gate--entering" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Enter PRAMAAN"
    >
      <div className="lp-gate__chrome lp-gate__chrome--tl">PRAMAAN / AUDIT ENGINE</div>
      <div className="lp-gate__chrome lp-gate__chrome--tr">status: {ready ? "ready" : "booting"}</div>
      <div className="lp-gate__word" aria-hidden="true">
        Evidence
      </div>
      <BootRobot entering={entering} />
      <div className="lp-gate__log" role="status" aria-live="polite">
        {lines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
      <button ref={buttonRef} type="button" className="lp-gate__start" onClick={dismiss} disabled={!ready || entering}>
        {ready ? "Enter" : "Booting…"}
      </button>
      <button type="button" className="lp-gate__skip" onClick={dismiss} disabled={entering}>
        Skip
      </button>
      <div className={`lp-gate__flash${flash ? " lp-gate__flash--peak" : ""}`} aria-hidden="true" />
    </div>
  );
}
