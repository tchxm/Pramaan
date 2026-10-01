import { useEffect, useRef, useState } from "react";

interface InteractiveVideoBackdropProps {
  src: string;
}

// Spec Section 9.3 — do not tune this without re-reading the seek-scheduler
// rationale below.
const SENSITIVITY = 0.8;

interface ScrubState {
  hasPointer: boolean;
  previousPointerX: number;
  currentPointerX: number;
  targetTime: number;
  seekInProgress: boolean;
}

/**
 * Full-screen fixed video backdrop. Horizontal mouse movement scrubs the
 * video's timeline.
 *
 * CRITICAL: all high-frequency scrub state (pointer position, target time,
 * seek-in-progress flag) lives in refs, never React state — mousemove fires
 * far too often for setState. The mousemove handler only writes refs and
 * asks a seek scheduler to run. The scheduler seeks toward the current
 * target, waits for the video's native `seeked` event, and only then checks
 * whether the target moved (materially) again while that seek was in
 * flight. If it did, it immediately starts the next seek; otherwise it goes
 * idle. This guarantees at most one in-flight `currentTime` write at a
 * time, no matter how fast the pointer moves — the flooding the spec
 * explicitly calls out as forbidden.
 *
 * React state (`isReady`, `hasError`) is used only for UI-level concerns,
 * never for per-pixel scrub tracking.
 */
export default function InteractiveVideoBackdrop({ src }: InteractiveVideoBackdropProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scrubRef = useRef<ScrubState>({
    hasPointer: false,
    previousPointerX: 0,
    currentPointerX: 0,
    targetTime: 0,
    seekInProgress: false,
  });
  const metadataReadyRef = useRef(false);
  const suppressScrubRef = useRef(false);

  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isTouchOnly =
      typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    suppressScrubRef.current = prefersReducedMotion || isTouchOnly;
  }, []);

  // Load lifecycle: mark metadata ready, surface (silent) load failures as
  // a graceful dark-background fallback rather than a console error / crash.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function onLoadedMetadata() {
      metadataReadyRef.current = true;
      if (video) {
        scrubRef.current.targetTime = video.currentTime;
      }
    }
    function onError() {
      setHasError(true);
    }

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("error", onError);
    if (video.readyState >= 1) onLoadedMetadata();

    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("error", onError);
    };
  }, []);

  // The mouse-scrub + seek-scheduler wiring.
  useEffect(() => {
    if (hasError) return;
    const video = videoRef.current;
    if (!video) return;

    function runSeekScheduler() {
      if (!video) return;
      const state = scrubRef.current;
      if (state.seekInProgress) return;
      if (!metadataReadyRef.current) return;

      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;

      const seekStartTarget = state.targetTime;
      if (Math.abs(video.currentTime - seekStartTarget) < 0.01) return;

      state.seekInProgress = true;
      try {
        video.currentTime = seekStartTarget;
      } catch {
        // Some browsers throw if seeking before the element is fully ready;
        // treat it as a no-op and let the next pointer move retry.
        state.seekInProgress = false;
        return;
      }

      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked);
        state.seekInProgress = false;
        if (Math.abs(state.targetTime - seekStartTarget) > 0.02) {
          runSeekScheduler();
        }
      };
      video.addEventListener("seeked", onSeeked);
    }

    function onMouseMove(e: MouseEvent) {
      if (!video) return;
      if (suppressScrubRef.current) return;
      if (!metadataReadyRef.current) return;

      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;

      const state = scrubRef.current;

      if (!state.hasPointer) {
        // First sample after mount / after re-entering the window: seed the
        // baseline without producing a spurious large delta.
        state.hasPointer = true;
        state.previousPointerX = e.clientX;
        state.currentPointerX = e.clientX;
        return;
      }

      state.previousPointerX = state.currentPointerX;
      state.currentPointerX = e.clientX;
      const deltaX = state.currentPointerX - state.previousPointerX;

      const timeDelta = (deltaX / window.innerWidth) * SENSITIVITY * duration;
      let nextTarget = state.targetTime + timeDelta;
      if (nextTarget < 0) nextTarget = 0;
      if (nextTarget > duration) nextTarget = duration;
      state.targetTime = nextTarget;

      runSeekScheduler();
    }

    function onMouseLeave() {
      // Stop seeking, preserve last position. Forget the pointer baseline so
      // re-entry doesn't compute a delta across the gap.
      scrubRef.current.hasPointer = false;
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseleave", onMouseLeave);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [hasError]);

  if (hasError) {
    // Graceful fallback: dark background, no error UI, no console noise.
    return <div className="fixed inset-0 z-0 bg-black" aria-hidden="true" />;
  }

  return (
    <video
      ref={videoRef}
      src={src}
      className="fixed inset-0 z-0 h-full w-full object-cover"
      style={{ objectPosition: "70% center" }}
      muted
      playsInline
      preload="auto"
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
