import { useEffect, useRef } from "react";
import * as THREE from "three";
import { updateRobotFraming } from "./robotFraming.js";

/**
 * The boot gate's robot companion. Built to the reference's actual visual
 * language: a heavily-rounded CRT monitor head in a thick dark bezel with a
 * thin illuminated gold perimeter frame (not a solid gold shell), a narrow
 * neck, a large matte dark torso, and physical cables — simulated with
 * Verlet integration + distance constraints, not static geometry, so they
 * lag and settle when the head moves. Pointer tracking lives on a dedicated
 * headPivot (torso stays still), clamped to small angles with a dead zone
 * so it reads as a machine watching you, not a toy chasing the cursor.
 *
 * Deliberately NOT built: a generalized multi-state machine (idle/
 * processing/warning/success/blocked) — this gate only ever has two states
 * (ready, entering), so a generic setState API would be dead code with
 * nothing in the app ever calling the unused branches.
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
    camera.position.set(0, 0.25, 7.2);

    // ---- warm, restrained lighting: silhouette + edges, not a floodlight ----
    scene.add(new THREE.HemisphereLight(0x163a35, 0x020605, 0.85));
    const key = new THREE.DirectionalLight(0x67dfd2, 1.3);
    key.position.set(-2, 3, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ef2df, 1.0);
    rim.position.set(3, -1, -2.5);
    scene.add(rim);

    // Soft warm backlight glow (canvas sprite, same technique as the
    // network scene behind this gate)
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = 256;
    glowCanvas.height = 256;
    const gctx = glowCanvas.getContext("2d")!;
    const grad = gctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, "rgba(103, 223, 210, 0.035)");
    grad.addColorStop(1, "rgba(103, 223, 210, 0)");
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, 256, 256);
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    const glowMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(5, 5, 1);
    glow.position.set(0, 0.6, -2.4);
    scene.add(glow);

    // ---- materials ----
    const shell = new THREE.MeshStandardMaterial({ color: 0x0f1716, metalness: 0.3, roughness: 0.75 });
    const torsoMat = new THREE.MeshStandardMaterial({ color: 0x0a1110, metalness: 0.2, roughness: 0.85 });
    const gold = new THREE.MeshStandardMaterial({
      color: 0x72ddcc,
      metalness: 0.65,
      roughness: 0.32,
      emissive: 0x247a6a,
      emissiveIntensity: 0.55,
    });
    // Standard lighting leaves cables on the shadowed side of the head
    // nearly black regardless of base color (grazing light angle), so a
    // stronger self-illumination baseline is used to keep them legible
    // from every angle — a deliberate departure from physically-correct
    // shading in favor of staying readable.
    const cableMat = new THREE.MeshStandardMaterial({
      color: 0x336b60,
      metalness: 0.2,
      roughness: 0.5,
      emissive: 0x204a40,
      emissiveIntensity: 1.1,
    });
    const litMat = new THREE.MeshStandardMaterial({ color: 0xb3f5e7, emissive: 0xb3f5e7, emissiveIntensity: 0.9 });
    const unlitMat = new THREE.MeshStandardMaterial({ color: 0x202a27, roughness: 0.8 });

    const root = new THREE.Group();
    scene.add(root);

    // ---- torso: heavy, rounded, featureless (lathe profile) ----
    const profile = [
      [0.02, -1.6],
      [0.55, -1.55],
      [1.05, -1.15],
      [1.14, -0.78],
      [0.96, -0.4],
      [0.64, -0.12],
      [0.4, 0.04],
      [0.3, 0.16],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const torso = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), torsoMat);
    root.add(torso);

    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.29, 0.16, 28), gold);
    collar.position.set(0, 0.22, -0.18);
    root.add(collar);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.5, 20), shell);
    neck.position.set(0, 0.58, -0.38);
    root.add(neck);

    // ---- headPivot: ALL tracking rotation happens here, nothing else ----
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 1.18, 0);
    root.add(headPivot);

    const HEAD_W = 1.72;
    const HEAD_H = 1.56;
    const HEAD_D = 0.46;

    // The bezel is a SOLID block — anything placed at a z-depth inside its
    // volume is hidden behind its own front face. So the bezel is shallow
    // and set back, with the frame/screen/dots/hubs all placed clearly in
    // front of its face rather than centered inside it. ExtrudeGeometry's
    // bevel pushes the real front face ~bevelThickness past the nominal
    // depth, so that overshoot is added explicitly rather than assumed away
    // (a first pass that ignored it buried the screen inside the bezel).
    const BEZEL_DEPTH = 0.3;
    const BEZEL_BEVEL = 0.03;
    const BEZEL_FRONT_NOMINAL = 0.04;
    const BEZEL_FRONT_REAL = BEZEL_FRONT_NOMINAL + BEZEL_BEVEL;
    const bezel = new THREE.Mesh(roundedBoxGeometry(HEAD_W, HEAD_H, BEZEL_DEPTH, 0.2, 5, BEZEL_BEVEL), shell);
    bezel.position.z = BEZEL_FRONT_NOMINAL - BEZEL_DEPTH / 2;
    headPivot.add(bezel);

    // Thin illuminated gold frame around the screen perimeter (a true
    // flat frame with a window cut out, not a solid tinted panel).
    const SCREEN_W = HEAD_W - 0.26;
    const SCREEN_H = HEAD_H - 0.3;
    const FRAME_DEPTH = 0.05;
    const FRAME_FRONT = BEZEL_FRONT_REAL + 0.06;
    const frame = new THREE.Mesh(
      roundedFrameGeometry(SCREEN_W + 0.1, SCREEN_H + 0.1, SCREEN_W, SCREEN_H, 0.1, FRAME_DEPTH),
      gold,
    );
    frame.position.set(0, 0, FRAME_FRONT - FRAME_DEPTH / 2);
    headPivot.add(frame);

    const screenCanvas = document.createElement("canvas");
    screenCanvas.width = 512;
    screenCanvas.height = 460;
    const sctx = screenCanvas.getContext("2d")!;
    const screenTex = new THREE.CanvasTexture(screenCanvas);
    screenTex.colorSpace = THREE.SRGBColorSpace;
    const screenMat = new THREE.MeshBasicMaterial({ map: screenTex });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), screenMat);
    screen.position.set(0, 0, BEZEL_FRONT_REAL + 0.03);
    headPivot.add(screen);

    // Small physical indicator lights along the lower bezel
    const DOT_COUNT = 6;
    const dots: THREE.Mesh[] = [];
    for (let i = 0; i < DOT_COUNT; i++) {
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.028, 16), unlitMat.clone());
      dot.position.set(-0.46 + i * 0.185, -HEAD_H / 2 + 0.16, BEZEL_FRONT_REAL + 0.01);
      headPivot.add(dot);
      dots.push(dot);
    }

    // Ear/cable-anchor hubs
    const anchorLocal: THREE.Vector3[] = [];
    for (const side of [-1, 1]) {
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 16), gold);
      hub.rotation.z = Math.PI / 2;
      hub.position.set(side * (HEAD_W / 2 - 0.02), -0.1, BEZEL_FRONT_REAL + 0.05);
      headPivot.add(hub);
      anchorLocal.push(hub.position.clone());
    }

    // ---- Verlet cables ----
    const cables = [
      new VerletCable(10, anchorLocal[0]!, new THREE.Vector3(-0.55, -1.0, 0.3), headPivot),
      new VerletCable(10, anchorLocal[1]!, new THREE.Vector3(0.55, -1.0, 0.3), headPivot),
    ];
    const cableMeshes: THREE.Mesh[] = cables.map(() => {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), cableMat);
      root.add(m);
      return m;
    });

    function drawScreen() {
      const w = screenCanvas.width;
      const h = screenCanvas.height;
      sctx.clearRect(0, 0, w, h);
      sctx.fillStyle = "#020605";
      sctx.fillRect(0, 0, w, h);

      sctx.font = "600 15px 'JetBrains Mono', monospace";
      sctx.fillStyle = "rgba(179, 245, 231, 0.7)";
      sctx.fillText("PRAMAAN / AUDIT ENGINE", 20, 32);

      sctx.textAlign = "center";
      sctx.font = "600 44px 'JetBrains Mono', monospace";
      sctx.shadowColor = "#72ddcc";
      sctx.shadowBlur = 16;
      sctx.fillStyle = "#d8fff5";
      sctx.fillText("ENTER", w / 2, h / 2 - 6);
      sctx.shadowBlur = 0;

      sctx.font = "500 14px 'JetBrains Mono', monospace";
      sctx.fillStyle = "rgba(176, 220, 208, 0.55)";
      sctx.fillText("click or press enter", w / 2, h / 2 + 34);
      sctx.textAlign = "left";

      sctx.font = "500 12px 'JetBrains Mono', monospace";
      sctx.fillStyle = "rgba(120, 168, 158, 0.55)";
      sctx.fillText("the rules decide, the evidence proves it.", 20, h - 70);

      // faint scanlines
      sctx.strokeStyle = "rgba(179, 245, 231, 0.035)";
      for (let y = 0; y < h; y += 4) {
        sctx.beginPath();
        sctx.moveTo(0, y);
        sctx.lineTo(w, y);
        sctx.stroke();
      }
      screenTex.needsUpdate = true;
    }

    root.updateWorldMatrix(true, true);
    const headBounds = new THREE.Box3().setFromObject(headPivot);
    const headAnchor = headBounds.getCenter(new THREE.Vector3());
    const modelBounds = new THREE.Box3().setFromObject(root);
    root.userData.framing = { head: headBounds, model: modelBounds };
    const headHeight = headBounds.max.y - headBounds.min.y;
    let framing = updateRobotFraming(window.innerWidth, window.innerHeight, headHeight);
    let viewportWidth = 1;
    let viewportHeight = 1;
    const robotLookTarget = new THREE.Vector3();
    function resize() {
      const rect = mount!.getBoundingClientRect();
      viewportWidth = Math.max(1, rect.width);
      viewportHeight = Math.max(1, rect.height);
      framing = updateRobotFraming(viewportWidth, viewportHeight, headHeight);
      renderer.setSize(viewportWidth, viewportHeight, false);
      camera.aspect = viewportWidth / viewportHeight;
      camera.fov = framing.fov;
      camera.position.set(headAnchor.x, headAnchor.y, framing.distance);
      camera.lookAt(headAnchor);
      camera.setViewOffset(viewportWidth, viewportHeight,
        (0.5 - framing.centerX) * viewportWidth, (0.5 - framing.centerY) * viewportHeight,
        viewportWidth, viewportHeight);
      camera.updateProjectionMatrix();
      if (reducedMotion) renderer.render(scene, camera);
    }
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    // ---- pointer tracking: headPivot only, deadzone + clamp + damping ----
    const pointer = { x: 0, y: 0 };
    const DEAD_ZONE = 0.05;
    const MAX_YAW = THREE.MathUtils.degToRad(12);
    const MAX_PITCH = THREE.MathUtils.degToRad(6);
    function onPointerMove(e: PointerEvent) {
      let nx = (e.clientX / window.innerWidth) * 2 - 1;
      let ny = -((e.clientY / window.innerHeight) * 2 - 1);
      nx = Math.max(-1, Math.min(1, nx));
      ny = Math.max(-1, Math.min(1, ny));
      if (Math.abs(nx) < DEAD_ZONE) nx = 0;
      if (Math.abs(ny) < DEAD_ZONE) ny = 0;
      pointer.x = nx;
      pointer.y = ny;
    }
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    const anchorScratch = new THREE.Vector3();
    let raf = 0;
    let t = 0;

    function tick() {
      t += 0.016;
      const isEntering = enteringRef.current;

      const targetYaw = reducedMotion || isEntering ? 0 : pointer.x * MAX_YAW;
      const targetPitch = reducedMotion || isEntering ? 0 : pointer.y * MAX_PITCH;
      headPivot.rotation.y += (targetYaw - headPivot.rotation.y) * 0.05;
      headPivot.rotation.x += (targetPitch - headPivot.rotation.x) * 0.05;

      // Idle motion: almost invisible vertical drift, nothing more.
      root.position.y = reducedMotion || isEntering ? root.position.y * 0.9 : Math.sin(t * 0.7) * 0.02;

      // "Enter" dollies the camera into the screen — the robot-to-story
      // handoff. BootGate flashes at the peak, then unmounts this scene to
      // reveal HeroStory's own scene already rendering behind it.
      const targetZ = isEntering ? 1.3 : framing.distance;
      const targetY2 = headAnchor.y + root.position.y;
      const targetFov = isEntering ? 56 : framing.fov;
      camera.position.z += (targetZ - camera.position.z) * (isEntering ? 0.12 : 0.05);
      camera.position.y += (targetY2 - camera.position.y) * (isEntering ? 0.12 : 0.05);
      camera.fov += (targetFov - camera.fov) * (isEntering ? 0.12 : 0.05);
      robotLookTarget.copy(headAnchor).add(root.position);
      camera.lookAt(robotLookTarget);
      if (isEntering && camera.view) {
        camera.view.offsetX *= 0.88;
        camera.view.offsetY *= 0.88;
      }
      camera.updateProjectionMatrix();
      gold.emissiveIntensity = isEntering ? Math.min(2.0, gold.emissiveIntensity + 0.07) : 0.55;

      const litCount = Math.min(DOT_COUNT, Math.floor(t / 0.9) % (DOT_COUNT + 2));
      for (let i = 0; i < DOT_COUNT; i++) {
        const lit = i < litCount;
        const m = dots[i]!.material as THREE.MeshStandardMaterial;
        m.color.set(lit ? 0xb3f5e7 : 0x202a27);
        m.emissive.set(lit ? 0xb3f5e7 : 0x000000);
        m.emissiveIntensity = lit ? 0.9 : 0;
      }

      headPivot.updateWorldMatrix(true, false);
      for (let i = 0; i < cables.length; i++) {
        const cable = cables[i]!;
        cable.anchorObject.localToWorld(anchorScratch.copy(cable.anchorLocal));
        root.worldToLocal(anchorScratch);
        cable.simulate(anchorScratch, reducedMotion);
        cable.writeTube(cableMeshes[i]!);
      }

      if (!reducedMotion) drawScreen();
      renderer.render(scene, camera);
      if (!reducedMotion) raf = requestAnimationFrame(tick);
    }

    function onVisibility() {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (!reducedMotion) raf = requestAnimationFrame(tick);
    }
    document.addEventListener("visibilitychange", onVisibility);

    drawScreen();
    // Settle the cables into a resting pose before the first paint so a
    // reduced-motion user still sees a physically plausible hang, not a
    // straight line.
    for (let settle = 0; settle < 40; settle++) {
      headPivot.updateWorldMatrix(true, false);
      for (let i = 0; i < cables.length; i++) {
        const cable = cables[i]!;
        cable.anchorObject.localToWorld(anchorScratch.copy(cable.anchorLocal));
        cable.simulate(anchorScratch, false);
      }
    }
    for (let i = 0; i < cables.length; i++) cables[i]!.writeTube(cableMeshes[i]!);
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
      glowTex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={mountRef} className="lp-gate__robot" aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Geometry helpers (no addon imports needed — built from THREE.Shape/Extrude)
// ---------------------------------------------------------------------------

function roundRectPath(path: THREE.Shape | THREE.Path, w: number, h: number, r: number): void {
  const x = -w / 2;
  const y = -h / 2;
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  path.lineTo(x + w, y + h - r);
  path.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  path.lineTo(x + r, y + h);
  path.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  path.lineTo(x, y + r);
  path.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
}

function roundedBoxGeometry(
  w: number,
  h: number,
  depth: number,
  radius: number,
  segments: number,
  bevel: number,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  roundRectPath(shape, w, h, radius);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: Math.max(1, segments),
    curveSegments: 10,
  });
  // Bevel extends the real z-extent beyond [0, depth] by ~bevel on each
  // end — callers that need an exact front-face z must account for this.
  geo.translate(0, 0, -depth / 2);
  return geo;
}

function roundedFrameGeometry(
  outerW: number,
  outerH: number,
  innerW: number,
  innerH: number,
  radius: number,
  depth: number,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  roundRectPath(shape, outerW, outerH, radius);
  const hole = new THREE.Path();
  roundRectPath(hole, innerW, innerH, radius * 0.6);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

// ---------------------------------------------------------------------------
// Verlet cable: anchor pinned to a moving head point, remaining points
// integrate under gravity and are held together by distance constraints —
// real secondary motion, not a static curve.
// ---------------------------------------------------------------------------

class VerletCable {
  points: THREE.Vector3[] = [];
  prev: THREE.Vector3[] = [];
  restLen: number;
  anchorLocal: THREE.Vector3;
  anchorObject: THREE.Object3D;

  constructor(segments: number, anchorLocal: THREE.Vector3, endLocal: THREE.Vector3, anchorObject: THREE.Object3D) {
    this.anchorLocal = anchorLocal;
    this.anchorObject = anchorObject;
    const start = anchorObject.localToWorld(anchorLocal.clone());
    const end = anchorObject.localToWorld(endLocal.clone());
    this.restLen = (start.distanceTo(end) / (segments - 1)) * 1.05;
    for (let i = 0; i < segments; i++) {
      const p = start.clone().lerp(end, i / (segments - 1));
      this.points.push(p);
      this.prev.push(p.clone());
    }
  }

  simulate(anchorWorld: THREE.Vector3, reducedMotion: boolean): void {
    const gravity = reducedMotion ? 0 : 0.0016;
    const damping = 0.97;
    for (let i = 1; i < this.points.length; i++) {
      const p = this.points[i]!;
      const prev = this.prev[i]!;
      const vx = (p.x - prev.x) * damping;
      const vy = (p.y - prev.y) * damping;
      const vz = (p.z - prev.z) * damping;
      prev.copy(p);
      p.x += vx;
      p.y += vy - gravity;
      p.z += vz;
    }
    this.points[0]!.copy(anchorWorld);

    for (let iter = 0; iter < 4; iter++) {
      for (let i = 0; i < this.points.length - 1; i++) {
        const p0 = this.points[i]!;
        const p1 = this.points[i + 1]!;
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const dz = p1.z - p0.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
        const diff = ((this.restLen - dist) / dist) * 0.5;
        const ox = dx * diff;
        const oy = dy * diff;
        const oz = dz * diff;
        if (i !== 0) {
          p0.x -= ox;
          p0.y -= oy;
          p0.z -= oz;
        }
        p1.x += ox;
        p1.y += oy;
        p1.z += oz;
      }
      this.points[0]!.copy(anchorWorld);
    }
  }

  writeTube(mesh: THREE.Mesh): void {
    const curve = new THREE.CatmullRomCurve3(this.points);
    const next = new THREE.TubeGeometry(curve, this.points.length * 2, 0.018, 6, false);
    mesh.geometry.dispose();
    mesh.geometry = next;
  }
}
