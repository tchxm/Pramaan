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

export default function BootGate() {
  const [open, setOpen] = useState(true);
  const [closing, setClosing] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const reducedRef = useRef(false);

  useEffect(() => {
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
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => setOpen(false), 420);
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
  }, [open, closing]);

  if (!open) return null;

  return (
    <div
      className={`lp-gate${closing ? " lp-gate--closing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Enter PRAMAAN"
    >
      <div className="lp-gate__chrome lp-gate__chrome--tl">PRAMAAN / AUDIT ENGINE</div>
      <div className="lp-gate__chrome lp-gate__chrome--tr">status: {ready ? "ready" : "booting"}</div>
      <div className="lp-gate__word" aria-hidden="true">
        Evidence
      </div>
      <BootRobot />
      <div className="lp-gate__log" role="status" aria-live="polite">
        {lines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
      <button ref={buttonRef} type="button" className="lp-gate__start" onClick={dismiss} disabled={!ready}>
        {ready ? "Enter" : "Booting…"}
      </button>
      <button type="button" className="lp-gate__skip" onClick={dismiss}>
        Skip
      </button>
    </div>
  );
}
