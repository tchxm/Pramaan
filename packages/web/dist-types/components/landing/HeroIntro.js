import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import TypewriterLine from "./TypewriterLine.js";
const TYPEWRITER_COPY = "Give it a frontend. PRAMAAN finds deceptive UI patterns, proposes bounded fixes, verifies every change with a deterministic engine, and leaves the evidence behind.";
/**
 * Blurred intro label + typewriter line. Copy is verbatim from spec
 * Sections 9.6 / 9.7 — do not paraphrase.
 */
export default function HeroIntro() {
    return (_jsxs("div", { children: [_jsxs("p", { className: "select-none font-normal leading-[1.3] text-white [filter:blur(4px)] [font-size:clamp(18px,4vw,26px)]", style: { pointerEvents: "none" }, children: ["Meet PRAMAAN,", _jsx("br", {}), "a deceptive-interface remediation and evidence engine"] }), _jsx(TypewriterLine, { text: TYPEWRITER_COPY, speed: 38, startDelay: 600, className: "mt-6 text-base leading-relaxed text-white sm:text-lg" })] }));
}
