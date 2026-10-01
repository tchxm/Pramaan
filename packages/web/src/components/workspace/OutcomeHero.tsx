import { useEffect, useRef, useState } from "react";
import "../../styles/workspace.css";

export interface OutcomeHeroProps {
  before: number;
  after: number;
  reduceMotion: boolean;
}

const COUNT_UP_MS = 600;

/**
 * S4 Outcome — spec's "one memorable moment". The headline reads
 * "{before} findings → {after} open". When reduceMotion is false, the
 * numbers tick up from 0 to their final values using only CSS-safe
 * rAF-driven text updates (no layout animation, no spring physics) per the
 * motion rules; reduceMotion (or prefers-reduced-motion) makes both numbers
 * appear instantly.
 */
export function OutcomeHero({ before, after, reduceMotion }: OutcomeHeroProps): JSX.Element {
  const [displayBefore, setDisplayBefore] = useState(reduceMotion ? before : 0);
  const [displayAfter, setDisplayAfter] = useState(reduceMotion ? after : 0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);

    if (reduceMotion) {
      setDisplayBefore(before);
      setDisplayAfter(after);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_UP_MS);
      setDisplayBefore(Math.round(before * t));
      setDisplayAfter(Math.round(after * t));
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [before, after, reduceMotion]);

  return (
    <div className="ws-outcome-hero">
      <p
        className="ws-outcome-hero__headline ws-mono"
        aria-live="polite"
      >
        <span data-testid="outcome-before">{displayBefore}</span>
        {" findings → "}
        <span data-testid="outcome-after">{displayAfter}</span>
        {" open"}
      </p>
    </div>
  );
}
