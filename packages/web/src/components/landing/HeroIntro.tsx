import TypewriterLine from "./TypewriterLine.js";

const TYPEWRITER_COPY =
  "Give it a frontend. PRAMAAN finds deceptive UI patterns, proposes bounded fixes, verifies every change with a deterministic engine, and leaves the evidence behind.";

/**
 * Hero headline + typewriter line. Headline copy is new for this redesign;
 * the typewriter copy is kept close to the original (spec 9.6/9.7's voice).
 */
export default function HeroIntro() {
  return (
    <div>
      <p className="lp-eyebrow">Agentic dark-pattern audit</p>
      <h1 className="lp-headline">
        Meet PRAMAAN.
        <br />
        It reads your interface <em>the way a regulator would</em> — then fixes what it finds, and proves it.
      </h1>

      <TypewriterLine text={TYPEWRITER_COPY} speed={38} startDelay={600} className="lp-lede" />
    </div>
  );
}
