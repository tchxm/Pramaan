import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createStoryScene, type StoryScene } from "./storyScene.js";
import HeroIntro from "../HeroIntro.js";
import HeroActions from "../HeroActions.js";
import "../../../styles/story.css";

/**
 * The home page's 5-beat scroll story (spec section 14): IDENTIFY, DETECT,
 * INVESTIGATE, VERIFY, PROVE. A single tall section with a `position:
 * sticky` stage inside it — scroll position through that section drives
 * both the Three.js camera/robot/network scene (storyScene.ts, imperative,
 * no React state) and each beat's DOM opacity, read directly off
 * getBoundingClientRect in a rAF loop rather than React state, so 60fps
 * scroll response never triggers a React re-render (spec section 37).
 *
 * Falls back to a plain stacked-sections layout (no pin, no 3D) under
 * prefers-reduced-motion, on narrow/short viewports, or if WebGL fails —
 * same real copy, no scroll-jacking, matching spec section 35's "no robot
 * if it hurts usability" guidance.
 */

const G1_G5 = [
  { id: "G1", label: "Detector clear" },
  { id: "G2", label: "Preservation" },
  { id: "G3", label: "Build" },
  { id: "G4", label: "Runtime" },
  { id: "G5", label: "No regression" },
];

const PATTERNS = [
  { id: "PRM-001", label: "Basket sneaking" },
  { id: "PRM-002", label: "False urgency" },
  { id: "PRM-003", label: "Interface interference" },
  { id: "PRM-004", label: "Drip pricing" },
  { id: "PRM-005", label: "Confirm shaming" },
];

const EVIDENCE_STEPS = [
  "Audit started",
  "Scan completed — findings captured",
  "Agent investigated",
  "Patch proposed",
  "Engine verified",
  "Evidence generated",
];

// [fadeInStart, fullStart, fullEnd, fadeOutEnd] in 0-1 scroll progress.
const BEAT_RANGES: [number, number, number, number][] = [
  [-1, -1, 0.03, 0.15],
  [0.08, 0.2, 0.32, 0.4],
  [0.3, 0.4, 0.56, 0.66],
  [0.58, 0.66, 0.8, 0.88],
  [0.8, 0.88, 1.02, 1.02],
];

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function beatOpacity(progress: number, [a, b, c, d]: [number, number, number, number]): number {
  return smoothstep(a, b, progress) * (1 - smoothstep(c, d, progress));
}

export default function HeroStory() {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const beatRefs = [useRef<HTMLDivElement | null>(null), useRef<HTMLDivElement | null>(null), useRef<HTMLDivElement | null>(null), useRef<HTMLDivElement | null>(null), useRef<HTMLDivElement | null>(null)];
  const hintRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const [simple, setSimple] = useState(true);

  useEffect(() => {
    function evaluate() {
      const reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const narrow = window.innerWidth < 860 || window.innerHeight < 560;
      setSimple(reducedMotion || narrow);
    }
    evaluate();
    window.addEventListener("resize", evaluate);
    return () => window.removeEventListener("resize", evaluate);
  }, []);

  useEffect(() => {
    if (simple) return;
    const section = sectionRef.current;
    const mount = mountRef.current;
    if (!section || !mount) return;

    const scene = createStoryScene(mount, false);
    if (!scene) {
      setSimple(true);
      return;
    }

    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(mount);

    const pointer = { x: 0, y: 0 };
    function onPointerMove(e: PointerEvent) {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
    }
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    let raf = 0;
    let last = performance.now();
    function tick(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const rect = section!.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const progress = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;

      scene!.update(progress, pointer.x, pointer.y, dt);

      for (let i = 0; i < BEAT_RANGES.length; i++) {
        const op = beatOpacity(progress, BEAT_RANGES[i]!);
        const el = beatRefs[i]!.current;
        if (el) {
          el.style.opacity = String(op);
          el.style.pointerEvents = op > 0.4 ? "auto" : "none";
          el.style.transform = `translateY(${(1 - op) * 10}px)`;
        }
      }
      if (hintRef.current) hintRef.current.style.opacity = String(1 - smoothstep(0, 0.06, progress));

      if (progress < 0.28) scene!.setScreenText({ header: "PRAMAAN / AUDIT ENGINE", action: "READY", sub: "observing" });
      else if (progress < 0.56) scene!.setScreenText({ header: "PRM-002 / FALSE URGENCY", action: "INVESTIGATING", sub: "tool 04 / 17" });
      else if (progress < 0.8) scene!.setScreenText({ header: "ENGINE CHECK", action: "G1 → G5", sub: "verifying" });
      else scene!.setScreenText({ header: "EVIDENCE", action: "RECORDED", sub: "sha-256 chained" });

      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    function onVisibility() {
      if (document.hidden) cancelAnimationFrame(raf);
      else {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
      scene!.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simple]);

  if (simple) {
    return (
      <div className="story story--simple">
        <section className="story__simple-beat story__simple-beat--1">
          <HeroIntro />
          <HeroActions />
        </section>
        <section className="story__simple-beat">
          <p className="story__eyebrow">First, evidence.</p>
          <h2 className="story__h2">Not an opinion.</h2>
          <p className="story__p">
            A deterministic detector engine walks the project's source and reads structural, CSS-cascade,
            and price-flow facts — never the agent's opinion.
          </p>
          <div className="story__badges">
            {PATTERNS.map((p) => (
              <span key={p.id} className="story__badge">
                {p.id} {p.label}
              </span>
            ))}
          </div>
        </section>
        <section className="story__simple-beat">
          <p className="story__eyebrow">When context is needed,</p>
          <h2 className="story__h2">the agent investigates.</h2>
          <p className="story__p">
            An LLM-driven agent can inspect the source, look up the regulation, and choose a bounded
            remediation strategy. It cannot grade its own work.
          </p>
        </section>
        <section className="story__simple-beat">
          <p className="story__eyebrow">The agent proposes.</p>
          <h2 className="story__h2">The engine decides.</h2>
          <div className="story__rail story__rail--simple">
            {G1_G5.map((g) => (
              <div key={g.id} className="story__rail-row">
                <span className="story__rail-id">{g.id}</span>
                <span>{g.label}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="story__simple-beat">
          <p className="story__eyebrow">Every decision leaves a record.</p>
          <h2 className="story__h2">Proof, not promises.</h2>
          <ol className="story__evidence-list">
            {EVIDENCE_STEPS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <button type="button" className="lp-pill lp-pill--primary" onClick={() => navigate("/audit")}>
            Run PRAMAAN &rarr;
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="story" ref={sectionRef}>
      <div className="story__stage">
        <div className="story__canvas-mount" ref={mountRef} />

        <div className="story__beat story__beat--1" ref={beatRefs[0]}>
          <div className="story__beat-inner">
            <HeroIntro />
            <HeroActions />
          </div>
        </div>

        <div className="story__beat story__beat--2" ref={beatRefs[1]}>
          <div className="story__beat-inner">
            <p className="story__eyebrow">First, evidence.</p>
            <h2 className="story__h2">Not an opinion.</h2>
            <p className="story__p">
              A deterministic detector engine walks the project's source and reads structural,
              CSS-cascade, and price-flow facts — never the agent's opinion.
            </p>
            <div className="story__badges">
              {PATTERNS.map((p) => (
                <span key={p.id} className="story__badge">
                  {p.id} {p.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="story__beat story__beat--3" ref={beatRefs[2]}>
          <div className="story__beat-inner">
            <p className="story__eyebrow">When context is needed,</p>
            <h2 className="story__h2">the agent investigates.</h2>
            <p className="story__p">
              The agent can inspect the source, look up the regulation, and choose a remediation
              strategy. It can retry. It cannot grade its own work — that call belongs to the engine
              below.
            </p>
          </div>
        </div>

        <div className="story__beat story__beat--4" ref={beatRefs[3]}>
          <div className="story__beat-inner">
            <p className="story__eyebrow">The agent proposes.</p>
            <h2 className="story__h2">The engine decides.</h2>
            <div className="story__rail">
              {G1_G5.map((g) => (
                <div key={g.id} className="story__rail-row">
                  <span className="story__rail-id">{g.id}</span>
                  <span className="story__rail-label">{g.label}</span>
                </div>
              ))}
              <div className="story__rail-verdict">Engine verdict</div>
            </div>
          </div>
        </div>

        <div className="story__beat story__beat--5" ref={beatRefs[4]}>
          <div className="story__beat-inner">
            <p className="story__eyebrow">Every decision leaves a record.</p>
            <h2 className="story__h2">Proof, not promises.</h2>
            <ol className="story__evidence-list">
              {EVIDENCE_STEPS.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <button type="button" className="lp-pill lp-pill--primary" onClick={() => navigate("/audit")}>
              Run PRAMAAN &rarr;
            </button>
          </div>
        </div>

        <div className="story__scroll-hint" ref={hintRef} aria-hidden="true">
          Scroll to enter the network &darr;
        </div>
      </div>
    </div>
  );
}
