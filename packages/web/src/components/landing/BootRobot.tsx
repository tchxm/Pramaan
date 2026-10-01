import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/**
 * The boot gate's robot companion — a rounded-square CRT-screen head in a
 * trim bezel, mounted on a bulbous base via two cable-ears, built to match
 * the reference's actual silhouette (not a sphere with floating eyes, which
 * read as a generic "robot emoji" rather than a real console). Still pure
 * primitive geometry + a canvas-texture screen (no bespoke shaders/Verlet
 * cable physics) — scoped to what's reliable in the time available, but the
 * shape and composition now genuinely match what was asked for.
 */
export default function BootRobot({ entering = false }: { entering?: boolean }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const enteringRef = useRef(entering);
  enteringRef.current = entering;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reducedMotion =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    camera.position.set(0, 0.35, 6.4);

    scene.add(new THREE.HemisphereLight(0x184339, 0x02110d, 0.95));
    const key = new THREE.DirectionalLight(0x4ee6b8, 1.5);
    key.position.set(-2, 3, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x4ee6b8, 1.2);
    rim.position.set(3, -1, -2);
    scene.add(rim);

    const root = new THREE.Group();
    scene.add(root);

    const shell = new THREE.MeshStandardMaterial({ color: 0x07110f, metalness: 0.5, roughness: 0.45 });
    const trim = new THREE.MeshStandardMaterial({
      color: 0x4ee6b8,
      metalness: 0.75,
      roughness: 0.25,
      emissive: 0x0e4336,
      emissiveIntensity: 0.4,
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0x050d0b, metalness: 0.4, roughness: 0.6 });

    // ---- Bulbous base (lathe profile: narrow neck, wide shoulder, tapered foot) ----
    const profile = [
      [0.02, -1.55],
      [0.5, -1.5],
      [0.98, -1.12],
      [1.08, -0.78],
      [0.92, -0.42],
      [0.62, -0.14],
      [0.4, 0.02],
      [0.3, 0.14],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const base = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), shell);
    root.add(base);

    // Neck collar (trim ring joining base to head)
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.14, 28), trim);
    collar.position.set(0, 0.2, 0);
    root.add(collar);

    // ---- Head: rounded-square bezel + inset CRT screen ----
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.0, 0);
    root.add(headGroup);

    const bezel = new THREE.Mesh(new RoundedBoxGeometry(1.74, 1.58, 0.42, 6, 0.22), trim);
    headGroup.add(bezel);

    const screenCanvas = document.createElement("canvas");
    screenCanvas.width = 512;
    screenCanvas.height = 460;
    const sctx = screenCanvas.getContext("2d")!;
    const screenTex = new THREE.CanvasTexture(screenCanvas);
    const screenMat = new THREE.MeshBasicMaterial({ map: screenTex });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.34), screenMat);
    screen.position.set(0, 0, 0.215);
    headGroup.add(screen);

    // Ear discs (ring + center hub, matching the reference's side pods)
    const earGroups: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const ear = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 12, 28), trim);
      ear.add(ring);
      const hub = new THREE.Mesh(new THREE.CircleGeometry(0.1, 20), dark);
      hub.position.z = 0.02;
      ear.add(hub);
      ear.rotation.y = Math.PI / 2;
      ear.position.set(side * 0.89, -0.05, 0);
      headGroup.add(ear);
      earGroups.push(ear);
    }

    // Cables: static curves from each ear down to the base shoulder. Drawn
    // in root space (not headGroup) so they don't visibly detach when the
    // head tilts a few degrees to track the pointer.
    const cableMat = new THREE.MeshStandardMaterial({ color: 0x0a1613, metalness: 0.3, roughness: 0.7 });
    for (const side of [-1, 1]) {
      const start = new THREE.Vector3(side * 0.89, headGroup.position.y - 0.05, 0.02);
      const mid = new THREE.Vector3(side * 1.05, headGroup.position.y - 0.75, 0.12);
      const end = new THREE.Vector3(side * 0.55, -0.55, 0.35);
      const curve = new THREE.CatmullRomCurve3([start, mid, end]);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.022, 8, false), cableMat);
      root.add(tube);
    }

    function drawScreen(blinkPhase: number, bootDots: number) {
      const w = screenCanvas.width;
      const h = screenCanvas.height;
      sctx.clearRect(0, 0, w, h);
      sctx.fillStyle = "#040907";
      sctx.fillRect(0, 0, w, h);

      sctx.font = "600 15px 'JetBrains Mono', monospace";
      sctx.fillStyle = "rgba(78, 230, 184, 0.75)";
      sctx.fillText("PRAMAAN / AUDIT ENGINE", 22, 34);

      sctx.textAlign = "center";
      sctx.font = "600 46px 'JetBrains Mono', monospace";
      sctx.shadowColor = "#9ff7dd";
      sctx.shadowBlur = blinkPhase > 0.5 ? 22 : 14;
      sctx.fillStyle = "#c8fff0";
      sctx.fillText("ENTER", w / 2, h / 2 - 6);
      sctx.shadowBlur = 0;

      sctx.font = "500 14px 'JetBrains Mono', monospace";
      sctx.fillStyle = "rgba(201, 230, 221, 0.55)";
      sctx.fillText("click or press enter", w / 2, h / 2 + 34);
      sctx.textAlign = "left";

      sctx.font = "500 12px 'JetBrains Mono', monospace";
      sctx.fillStyle = "rgba(147, 168, 160, 0.6)";
      sctx.fillText("the rules decide, the evidence proves it.", 22, h - 60);

      const dotCount = 6;
      const dotY = h - 26;
      for (let i = 0; i < dotCount; i++) {
        const lit = i < bootDots;
        sctx.beginPath();
        sctx.arc(24 + i * 20, dotY, lit ? 4.5 : 3.5, 0, Math.PI * 2);
        sctx.fillStyle = lit ? "#c8fff0" : "rgba(147, 168, 160, 0.35)";
        sctx.fill();
      }

      // Faint scanlines for CRT texture
      sctx.strokeStyle = "rgba(78, 230, 184, 0.04)";
      sctx.lineWidth = 1;
      for (let y = 0; y < h; y += 4) {
        sctx.beginPath();
        sctx.moveTo(0, y);
        sctx.lineTo(w, y);
        sctx.stroke();
      }

      screenTex.needsUpdate = true;
    }

    function resize() {
      const rect = mount!.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    const pointer = { x: 0, y: 0 };
    function onPointerMove(e: PointerEvent) {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    }
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    let raf = 0;
    let t = 0;
    const headBaseY = headGroup.position.y;
    function tick() {
      t += 0.016;
      const isEntering = enteringRef.current;
      const targetY = reducedMotion || isEntering ? 0 : pointer.x * 0.26;
      const targetX = reducedMotion || isEntering ? 0 : -pointer.y * 0.12;
      headGroup.rotation.y += (targetY - headGroup.rotation.y) * 0.06;
      headGroup.rotation.x += (targetX - headGroup.rotation.x) * 0.06;
      root.position.y = reducedMotion || isEntering ? root.position.y * 0.9 : Math.sin(t * 1.1) * 0.035;

      for (const ear of earGroups) ear.rotation.z = Math.sin(t * 0.8) * 0.03;

      // "Enter" dollies the camera into the screen — this is the camera half
      // of the robot-to-globe handoff: BootGate flashes white at the dolly's
      // peak, then unmounts this scene and reveals HeroGlobe already
      // rendering behind it, so the cut reads as one continuous push rather
      // than a hard swap between two scenes.
      const targetZ = isEntering ? 1.0 : 6.4;
      const targetY2 = isEntering ? headBaseY + root.position.y : 0.35;
      const targetFov = isEntering ? 58 : 28;
      camera.position.z += (targetZ - camera.position.z) * (isEntering ? 0.12 : 0.06);
      camera.position.y += (targetY2 - camera.position.y) * (isEntering ? 0.12 : 0.06);
      camera.fov += (targetFov - camera.fov) * (isEntering ? 0.12 : 0.06);
      camera.updateProjectionMatrix();
      trim.emissiveIntensity = isEntering ? Math.min(2.4, trim.emissiveIntensity + 0.09) : 0.4;

      const blinkPhase = (Math.sin(t * 1.6) + 1) / 2;
      const bootDots = Math.min(6, Math.floor(t / 1.1));
      if (!reducedMotion) drawScreen(blinkPhase, bootDots);
      else if (t < 0.1) drawScreen(0, 6);

      renderer.render(scene, camera);
      if (!reducedMotion) raf = requestAnimationFrame(tick);
    }

    function onVisibility() {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (!reducedMotion) raf = requestAnimationFrame(tick);
    }
    document.addEventListener("visibilitychange", onVisibility);

    drawScreen(0, 6);
    if (reducedMotion) renderer.render(scene, camera);
    else raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      screenTex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={mountRef} className="lp-gate__robot" aria-hidden="true" />;
}
