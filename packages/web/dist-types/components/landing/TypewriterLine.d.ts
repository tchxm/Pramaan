interface TypewriterLineProps {
    text: string;
    speed?: number;
    startDelay?: number;
    className?: string;
}
/**
 * Renders `text` with the typewriter effect. The animated, partially
 * revealed string is hidden from assistive technology (aria-hidden); a
 * permanent sr-only span carries the full final text so screen readers
 * read the complete sentence once rather than a stream of growing
 * fragments.
 */
export default function TypewriterLine({ text, speed, startDelay, className }: TypewriterLineProps): import("react").JSX.Element;
export {};
