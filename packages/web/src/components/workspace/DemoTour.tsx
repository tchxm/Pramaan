import { useEffect, useRef, useState } from "react";

/**
 * A short guided overlay for "Watch the demo" — so a judge seeing the
 * workspace cold for the first time understands what each pane actually
 * means, without needing anyone to explain it out loud. Only mounted when
 * the audit URL carries `?tour=1` (wired from the landing page's "Watch
 * the demo" button through S1Start's auto-start). Purely presentational:
 * reads the DOM via getBoundingClientRect, never touches store state.
 */
interface Step {
  selector: string;
  title: string;
  text: string;
}

const STEPS: Step[] = [
  {
    selector: ".scr-left-pane",
    title: "What it found",
    text: "Each row is a deceptive pattern PRAMAAN detected — flagged by a deterministic rule against the real source, not a guess from the model.",
  },
  {
    selector: ".scr-center-pane",
    title: "The exact code, and the fix",
    text: "The real source file, with the finding highlighted, plus the bounded fix the agent proposes. Nothing here is applied until it's verified or a human approves it.",
  },
  {
    selector: ".scr-right-pane",
    title: "The evidence behind the claim",
    text: "The signals that fired, the regulation it maps to, and each verification gate's real pass/fail result — this is what makes the finding defensible, not just asserted.",
  },
  {
    selector: ".scr-trace-strip-wrap",
    title: "A tamper-evident trail",
    text: "Every action the engine, the agent, or a human takes is logged here in order and hashed into a chain — so the evidence pack can be independently re-verified later.",
  },
];

export default function DemoTour({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const raf = useRef(0);

  useEffect(() => {
    function place() {
      const el = document.querySelector(STEPS[step]!.selector);
      if (!el) {
        // Target not present at this breakpoint/moment — skip ahead rather
        // than show a caption pointing at nothing.
        if (step < STEPS.length - 1) setStep((s) => s + 1);
        else onFinish();
        return;
      }
      setRect(el.getBoundingClientRect());
      raf.current = requestAnimationFrame(place);
    }
    raf.current = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onFinish();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onFinish]);

  if (!rect) return null;
  const current = STEPS[step]!;
  const cardTop = Math.min(window.innerHeight - 180, Math.max(12, rect.bottom + 12));
  const cardLeft = Math.min(window.innerWidth - 340, Math.max(12, rect.left));

  return (
    <div className="ws-tour" role="dialog" aria-modal="false" aria-label="Guided demo">
      <div
        className="ws-tour__ring"
        style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
      />
      <div className="ws-tour__card" style={{ top: cardTop, left: cardLeft }}>
        <p className="ws-tour__step">
          Step {step + 1} / {STEPS.length}
        </p>
        <h3 className="ws-tour__title">{current.title}</h3>
        <p className="ws-tour__text">{current.text}</p>
        <div className="ws-tour__actions">
          <button type="button" className="scr-secondary-btn" onClick={onFinish}>
            Skip tour
          </button>
          <button
            type="button"
            className="scr-primary-btn"
            style={{ marginTop: 0 }}
            onClick={() => (step < STEPS.length - 1 ? setStep((s) => s + 1) : onFinish())}
          >
            {step < STEPS.length - 1 ? "Next" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
