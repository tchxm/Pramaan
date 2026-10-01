import { useEffect, useRef, useState } from "react";

export interface TypewriterResult {
  displayed: string;
  done: boolean;
}

/**
 * Reveals `text` one character at a time.
 *
 * Strict-Mode-safe: every run of the effect clears any previously scheduled
 * timeout/interval before starting new ones, so React 18 StrictMode's
 * mount -> unmount -> remount double-invoke never produces two competing
 * timers (which would otherwise double-type the string).
 */
export function useTypewriter(text: string, speed = 38, startDelay = 600): TypewriterResult {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(text.length === 0);
  const timeoutRef = useRef<number | undefined>(undefined);
  const intervalRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (timeoutRef.current !== undefined) window.clearTimeout(timeoutRef.current);
    if (intervalRef.current !== undefined) window.clearInterval(intervalRef.current);

    if (text.length === 0) {
      setDisplayed("");
      setDone(true);
      return;
    }

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      setDisplayed(text);
      setDone(true);
      return;
    }

    setDisplayed("");
    setDone(false);

    timeoutRef.current = window.setTimeout(() => {
      let index = 0;
      intervalRef.current = window.setInterval(() => {
        index += 1;
        if (!mountedRef.current) return;
        setDisplayed(text.slice(0, index));
        if (index >= text.length) {
          if (intervalRef.current !== undefined) {
            window.clearInterval(intervalRef.current);
            intervalRef.current = undefined;
          }
          setDone(true);
        }
      }, speed);
    }, startDelay);

    return () => {
      if (timeoutRef.current !== undefined) window.clearTimeout(timeoutRef.current);
      if (intervalRef.current !== undefined) window.clearInterval(intervalRef.current);
    };
  }, [text, speed, startDelay]);

  return { displayed, done };
}
