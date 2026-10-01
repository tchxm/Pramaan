import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import HeroCanvas from "./HeroCanvas.js";

/**
 * The hero's signature visual: a slowly rotating point-and-line lattice
 * globe, in the product's own gold/cream palette, that leans gently toward
 * the pointer. Three.js, no postprocessing pipeline — glow comes from a
 * soft radial-gradient sprite texture + additive blending, which looks
 * premium without the extra weight/fragility of a full bloom pass.
 *
 * Falls back to the flat canvas lattice (HeroCanvas) if WebGL is
 * unavailable, or renders one static frame under prefers-reduced-motion.
 */
export default function HeroGlobe() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reducedMotion =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      setWebglFailed(true);
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 7.6);

    const root = new THREE.Group();
    scene.add(root);

    // Soft radial-gradient glow texture for points — cheap stand-in for a
    // bloom pass.
    function glowTexture(hex: string): THREE.CanvasTexture {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const ctx = c.getContext("2d")!;
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, hex);
      g.addColorStop(0.4, hex + "99");
      g.addColorStop(1, hex + "00");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    }

    const goldTex = glowTexture("#4ee6b8");
    const creamTex = glowTexture("#eef6f2");

    // Fibonacci sphere point distribution.
    const N = 620;
    const R = 2.4;
    const positions = new Float32Array(N * 3);
    const points: THREE.Vector3[] = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;
      const x = Math.cos(theta) * r * R;
      const z = Math.sin(theta) * r * R;
      const yy = y * R;
      positions[i * 3] = x;
      positions[i * 3 + 1] = yy;
      positions[i * 3 + 2] = z;
      points.push(new THREE.Vector3(x, yy, z));
    }
    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const particles = new THREE.Points(
      pointsGeo,
      new THREE.PointsMaterial({
        size: 0.045,
        map: goldTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.85,
      }),
    );
    root.add(particles);

    // A sparser set of brighter "hub" points for visual hierarchy.
    const H = 46;
    const hubPositions = new Float32Array(H * 3);
    for (let i = 0; i < H; i++) {
      const id = (i * 13) % N;
      hubPositions[i * 3] = positions[id * 3]!;
      hubPositions[i * 3 + 1] = positions[id * 3 + 1]!;
      hubPositions[i * 3 + 2] = positions[id * 3 + 2]!;
    }
    const hubGeo = new THREE.BufferGeometry();
    hubGeo.setAttribute("position", new THREE.BufferAttribute(hubPositions, 3));
    const hubs = new THREE.Points(
      hubGeo,
      new THREE.PointsMaterial({
        size: 0.1,
        map: creamTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.95,
      }),
    );
    root.add(hubs);

    // Sparse connecting lattice lines between nearby points.
    const linePositions: number[] = [];
    const maxDist = 0.5;
    for (let i = 0; i < N; i += 3) {
      const a = points[i]!;
      for (let step = 1; step <= 5; step++) {
        const j = (i + step * 17) % N;
        const b = points[j]!;
        if (a.distanceTo(b) < maxDist) {
          linePositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    const lines = new THREE.LineSegments(
      lineGeo,
      new THREE.LineBasicMaterial({
        color: 0x4ee6b8,
        transparent: true,
        opacity: 0.15,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    root.add(lines);

    // Inner faint wireframe shell for depth.
    const inner = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.5, 1),
      new THREE.MeshBasicMaterial({ color: 0x4ee6b8, wireframe: true, transparent: true, opacity: 0.1 }),
    );
    root.add(inner);

    let width = 0;
    let height = 0;
    function resize() {
      const rect = mount!.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);
    resize();

    const pointer = { x: 0, y: 0 };
    const target = { rx: 0, ry: 0 };
    function onPointerMove(e: PointerEvent) {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    }
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let rafId = 0;
    let t = 0;
    function tick() {
      t += 0.0035;
      root.rotation.y = t * 0.35;
      target.ry += (pointer.x * 0.25 - target.ry) * 0.04;
      target.rx += (-pointer.y * 0.12 - target.rx) * 0.04;
      root.rotation.x = target.rx;
      camera.position.x = target.ry * 0.6;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(tick);
    }

    function onVisibility() {
      if (document.hidden) cancelAnimationFrame(rafId);
      else if (!reducedMotion) rafId = requestAnimationFrame(tick);
    }
    document.addEventListener("visibilitychange", onVisibility);

    if (reducedMotion) {
      renderer.render(scene, camera);
    } else {
      rafId = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
      pointsGeo.dispose();
      hubGeo.dispose();
      lineGeo.dispose();
      inner.geometry.dispose();
      (inner.material as THREE.Material).dispose();
      (particles.material as THREE.Material).dispose();
      (hubs.material as THREE.Material).dispose();
      (lines.material as THREE.Material).dispose();
      goldTex.dispose();
      creamTex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  if (webglFailed) return <HeroCanvas />;

  return <div ref={mountRef} className="lp-hero-canvas" aria-hidden="true" />;
}
