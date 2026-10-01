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
export declare function useTypewriter(text: string, speed?: number, startDelay?: number): TypewriterResult;
