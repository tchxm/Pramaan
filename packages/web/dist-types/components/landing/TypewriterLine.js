import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useTypewriter } from "./useTypewriter.js";
/**
 * Renders `text` with the typewriter effect. The animated, partially
 * revealed string is hidden from assistive technology (aria-hidden); a
 * permanent sr-only span carries the full final text so screen readers
 * read the complete sentence once rather than a stream of growing
 * fragments.
 */
export default function TypewriterLine({ text, speed = 38, startDelay = 600, className }) {
    const { displayed, done } = useTypewriter(text, speed, startDelay);
    return (_jsxs("p", { className: className, children: [_jsxs("span", { "aria-hidden": "true", children: [displayed, !done && _jsx("span", { className: "pramaan-caret" })] }), _jsx("span", { className: "sr-only", children: text })] }));
}
