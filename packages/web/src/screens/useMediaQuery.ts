// Small breakpoint hook for the S2 Workspace responsive layout (spec 18.8):
// >=1280 full three-pane, 1024-1279 right panel collapses to tabs, <1024
// single column with tabs. Screens-local; not shared with the landing page.
import { useEffect, useState } from "react";

export type Breakpoint = "wide" | "medium" | "narrow";

function computeBreakpoint(width: number): Breakpoint {
  if (width >= 1280) return "wide";
  if (width >= 1024) return "medium";
  return "narrow";
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() =>
    computeBreakpoint(typeof window === "undefined" ? 1280 : window.innerWidth),
  );

  useEffect(() => {
    function onResize(): void {
      setBp(computeBreakpoint(window.innerWidth));
    }
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return bp;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const listener = (e: MediaQueryListEvent): void => setReduced(e.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);
  return reduced;
}
