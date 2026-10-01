interface InteractiveVideoBackdropProps {
    src: string;
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
export default function InteractiveVideoBackdrop({ src }: InteractiveVideoBackdropProps): import("react").JSX.Element;
export {};
