import * as THREE from "three";

/**
 * The single Three.js scene behind the home page's 5-beat scroll story.
 * Owns two visual elements that trade dominance as the user scrolls:
 *   - a network lattice (same point-cloud technique as the old HeroGlobe)
 *   - a robot companion (same visual language as the boot gate's robot —
 *     rounded CRT head in a thin gold frame, bulbous torso, Verlet cables —
 *     rebuilt here as an independent copy rather than a shared import, so
 *     changing this scene can never regress the already-verified boot gate)
 *
 * `update(progress, pointer)` is called every frame from HeroStory's own
 * rAF loop with the 0-1 scroll progress through the story; this module
 * does no state management of its own beyond the Three.js objects, and
 * does no React rendering — it's a thin, disposable, imperative layer so
 * 60fps scroll-driven camera work never touches React's render cycle.
 */

export interface StoryBeatText {
  header: string;
  action: string;
  sub: string;
}

export interface StoryScene {
  renderer: THREE.WebGLRenderer;
  resize(): void;
  update(progress: number, pointerX: number, pointerY: number, dt: number): void;
  setScreenText(text: StoryBeatText): void;
  dispose(): void;
}

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

function roundedBoxGeometry(w: number, h: number, depth: number, radius: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  roundRectPath(shape, w, h, radius);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 10,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

function roundedFrameGeometry(outerW: number, outerH: number, innerW: number, innerH: number, radius: number, depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  roundRectPath(shape, outerW, outerH, radius);
  const hole = new THREE.Path();
  roundRectPath(hole, innerW, innerH, radius * 0.6);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

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

  simulate(anchorWorld: THREE.Vector3): void {
    const gravity = 0.0016;
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

export function createStoryScene(mount: HTMLElement, reducedMotion: boolean): StoryScene | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.domElement.setAttribute("aria-hidden", "true");
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0, 9);

  scene.add(new THREE.HemisphereLight(0x184339, 0x02110d, 0.9));
  const key = new THREE.DirectionalLight(0x4ee6b8, 1.3);
  key.position.set(-2, 3, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x4ee6b8, 1.0);
  rim.position.set(3, -1, -2);
  scene.add(rim);

  // ---------------- Network lattice ----------------
  const networkGroup = new THREE.Group();
  networkGroup.position.set(1.6, 0, 0);
  scene.add(networkGroup);

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

  const N = 560;
  const R = 2.3;
  const netPositions = new Float32Array(N * 3);
  const netPoints: THREE.Vector3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const x = Math.cos(theta) * r * R;
    const z = Math.sin(theta) * r * R;
    const yy = y * R;
    netPositions[i * 3] = x;
    netPositions[i * 3 + 1] = yy;
    netPositions[i * 3 + 2] = z;
    netPoints.push(new THREE.Vector3(x, yy, z));
  }
  const netGeo = new THREE.BufferGeometry();
  netGeo.setAttribute("position", new THREE.BufferAttribute(netPositions, 3));
  const netParticles = new THREE.Points(
    netGeo,
    new THREE.PointsMaterial({ size: 0.045, map: goldTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 }),
  );
  networkGroup.add(netParticles);

  const H = 5; // exactly 5 hub points — the 5 detector pattern families
  const hubPositions = new Float32Array(H * 3);
  const hubIndices = [0, 110, 230, 340, 460];
  for (let i = 0; i < H; i++) {
    const id = hubIndices[i]! % N;
    hubPositions[i * 3] = netPositions[id * 3]!;
    hubPositions[i * 3 + 1] = netPositions[id * 3 + 1]!;
    hubPositions[i * 3 + 2] = netPositions[id * 3 + 2]!;
  }
  const hubGeo = new THREE.BufferGeometry();
  hubGeo.setAttribute("position", new THREE.BufferAttribute(hubPositions, 3));
  const hubMat = new THREE.PointsMaterial({ size: 0.16, map: creamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.95 });
  const hubs = new THREE.Points(hubGeo, hubMat);
  networkGroup.add(hubs);

  const linePositions: number[] = [];
  const maxDist = 0.5;
  for (let i = 0; i < N; i += 3) {
    const a = netPoints[i]!;
    for (let step = 1; step <= 5; step++) {
      const j = (i + step * 17) % N;
      const b = netPoints[j]!;
      if (a.distanceTo(b) < maxDist) linePositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: 0x4ee6b8, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  networkGroup.add(lines);

  const innerShellMat = new THREE.MeshBasicMaterial({ color: 0x4ee6b8, wireframe: true, transparent: true, opacity: 0.1 });
  const innerShell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 1), innerShellMat);
  networkGroup.add(innerShell);

  // ---------------- Robot ----------------
  const robotRoot = new THREE.Group();
  robotRoot.position.set(-2.2, -0.3, 1);
  scene.add(robotRoot);

  const shellMat = new THREE.MeshStandardMaterial({ color: 0x07110f, metalness: 0.5, roughness: 0.45 });
  const torsoMat = new THREE.MeshStandardMaterial({ color: 0x050d0b, metalness: 0.2, roughness: 0.85 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0x4ee6b8, metalness: 0.7, roughness: 0.3, emissive: 0x0e4336, emissiveIntensity: 0.5 });
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x1a3f33, metalness: 0.2, roughness: 0.6, emissive: 0x0b241d, emissiveIntensity: 0.6 });
  const unlitDotMat = new THREE.MeshStandardMaterial({ color: 0x1b2a26, roughness: 0.8 });

  const profile = [
    [0.02, -1.5], [0.5, -1.45], [0.95, -1.08], [1.05, -0.74],
    [0.9, -0.38], [0.6, -0.12], [0.38, 0.03], [0.28, 0.14],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const torso = new THREE.Mesh(new THREE.LatheGeometry(profile, 36), torsoMat);
  robotRoot.add(torso);

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.27, 0.14, 24), goldMat);
  collar.position.set(0, 0.21, 0);
  robotRoot.add(collar);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.46, 18), shellMat);
  neck.position.set(0, 0.56, 0);
  robotRoot.add(neck);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.12, 0);
  robotRoot.add(headPivot);

  const HEAD_W = 1.6;
  const HEAD_H = 1.44;
  const BEZEL_DEPTH = 0.28;
  const BEZEL_BEVEL = 0.03;
  const BEZEL_FRONT_NOMINAL = 0.04;
  const BEZEL_FRONT_REAL = BEZEL_FRONT_NOMINAL + BEZEL_BEVEL;
  const bezel = new THREE.Mesh(roundedBoxGeometry(HEAD_W, HEAD_H, BEZEL_DEPTH, 0.18, BEZEL_BEVEL), shellMat);
  bezel.position.z = BEZEL_FRONT_NOMINAL - BEZEL_DEPTH / 2;
  headPivot.add(bezel);

  const SCREEN_W = HEAD_W - 0.24;
  const SCREEN_H = HEAD_H - 0.28;
  const FRAME_DEPTH = 0.05;
  const FRAME_FRONT = BEZEL_FRONT_REAL + 0.06;
  const frame = new THREE.Mesh(roundedFrameGeometry(SCREEN_W + 0.09, SCREEN_H + 0.09, SCREEN_W, SCREEN_H, 0.09, FRAME_DEPTH), goldMat);
  frame.position.set(0, 0, FRAME_FRONT - FRAME_DEPTH / 2);
  headPivot.add(frame);

  const screenCanvas = document.createElement("canvas");
  screenCanvas.width = 480;
  screenCanvas.height = 420;
  const sctx = screenCanvas.getContext("2d")!;
  const screenTex = new THREE.CanvasTexture(screenCanvas);
  const screenMat = new THREE.MeshBasicMaterial({ map: screenTex });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), screenMat);
  screen.position.set(0, 0, BEZEL_FRONT_REAL + 0.03);
  headPivot.add(screen);

  const DOT_COUNT = 6;
  for (let i = 0; i < DOT_COUNT; i++) {
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.024, 14), unlitDotMat);
    dot.position.set(-0.42 + i * 0.17, -HEAD_H / 2 + 0.14, BEZEL_FRONT_REAL + 0.01);
    headPivot.add(dot);
  }

  const anchorLocal: THREE.Vector3[] = [];
  for (const side of [-1, 1]) {
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 14), goldMat);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(side * (HEAD_W / 2 - 0.02), -0.09, BEZEL_FRONT_REAL + 0.04);
    headPivot.add(hub);
    anchorLocal.push(hub.position.clone());
  }
  const cables = [
    new VerletCable(9, anchorLocal[0]!, new THREE.Vector3(-0.5, -0.95, 0.28), headPivot),
    new VerletCable(9, anchorLocal[1]!, new THREE.Vector3(0.5, -0.95, 0.28), headPivot),
  ];
  const cableMeshes: THREE.Mesh[] = cables.map(() => {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), cableMat);
    robotRoot.add(m);
    return m;
  });

  let currentText: StoryBeatText = { header: "PRAMAAN / AUDIT ENGINE", action: "READY", sub: "observing" };
  let screenDirty = true;

  function drawScreen(): void {
    const w = screenCanvas.width;
    const h = screenCanvas.height;
    sctx.clearRect(0, 0, w, h);
    sctx.fillStyle = "#050a08";
    sctx.fillRect(0, 0, w, h);
    sctx.font = "600 13px 'JetBrains Mono', monospace";
    sctx.fillStyle = "rgba(78, 230, 184, 0.75)";
    sctx.fillText(currentText.header, 18, 28);
    sctx.textAlign = "center";
    sctx.font = "600 38px 'JetBrains Mono', monospace";
    sctx.shadowColor = "#9ff7dd";
    sctx.shadowBlur = 16;
    sctx.fillStyle = "#c8fff0";
    sctx.fillText(currentText.action, w / 2, h / 2);
    sctx.shadowBlur = 0;
    sctx.font = "500 14px 'JetBrains Mono', monospace";
    sctx.fillStyle = "rgba(201, 230, 221, 0.55)";
    sctx.fillText(currentText.sub, w / 2, h / 2 + 32);
    sctx.textAlign = "left";
    sctx.strokeStyle = "rgba(78, 230, 184, 0.035)";
    for (let y = 0; y < h; y += 4) {
      sctx.beginPath();
      sctx.moveTo(0, y);
      sctx.lineTo(w, y);
      sctx.stroke();
    }
    screenTex.needsUpdate = true;
    screenDirty = false;
  }
  drawScreen();

  function resize(): void {
    const rect = mount.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();

  const anchorScratch = new THREE.Vector3();
  let t = 0;

  function update(progress: number, pointerX: number, pointerY: number, dt: number): void {
    t += dt;

    // Beat windows: [0,.2) identify, [.2,.4) detect, [.4,.6) investigate,
    // [.6,.8) verify, [.8,1] prove.
    const bNetwork = 1 - smoothstep(0.32, 0.5, progress); // network dominant through beats 1-2, fades into 3
    const bRobot = smoothstep(0.28, 0.42, progress) * (1 - smoothstep(0.72, 0.88, progress));
    const bAmbient = smoothstep(0.78, 0.92, progress); // both dim to near-ambient for verify/evidence beats

    networkGroup.visible = bNetwork > 0.01;
    const netOpacity = bNetwork * (1 - bAmbient * 0.7);
    (netParticles.material as THREE.PointsMaterial).opacity = 0.85 * netOpacity;
    hubMat.opacity = 0.95 * netOpacity;
    lineMat.opacity = 0.15 * netOpacity;
    innerShellMat.opacity = 0.1 * netOpacity;
    networkGroup.rotation.y = t * 0.12;
    networkGroup.scale.setScalar(THREE.MathUtils.lerp(1, 0.72, smoothstep(0.0, 0.3, progress)));
    networkGroup.position.x = THREE.MathUtils.lerp(1.6, 3.0, smoothstep(0.0, 0.3, progress));

    robotRoot.visible = bRobot > 0.01 || bAmbient > 0.01;
    const robotOpacity = Math.max(bRobot, bAmbient * 0.35);
    setGroupOpacity(robotRoot, robotOpacity);
    const robotFocus = smoothstep(0.3, 0.46, progress) * (1 - smoothstep(0.7, 0.86, progress));
    robotRoot.position.x = THREE.MathUtils.lerp(-2.2, 0, robotFocus);
    robotRoot.position.y = THREE.MathUtils.lerp(-0.3, -0.75, robotFocus);
    robotRoot.position.z = THREE.MathUtils.lerp(1, 3.0, robotFocus);
    robotRoot.scale.setScalar(THREE.MathUtils.lerp(0.85, 1.05, robotFocus));

    const targetYaw = pointerX * THREE.MathUtils.degToRad(10);
    const targetPitch = pointerY * THREE.MathUtils.degToRad(5);
    headPivot.rotation.y += (targetYaw - headPivot.rotation.y) * 0.05;
    headPivot.rotation.x += (targetPitch - headPivot.rotation.x) * 0.05;
    robotRoot.position.y += Math.sin(t * 0.7) * 0.025;

    if (screenDirty) drawScreen();

    headPivot.updateWorldMatrix(true, false);
    for (let i = 0; i < cables.length; i++) {
      const cable = cables[i]!;
      cable.anchorObject.localToWorld(anchorScratch.copy(cable.anchorLocal));
      cable.simulate(anchorScratch);
      cable.writeTube(cableMeshes[i]!);
    }

    camera.position.x = THREE.MathUtils.lerp(0, -0.4, robotFocus) + pointerX * 0.15;
    camera.position.y = pointerY * 0.08;
    camera.position.z = THREE.MathUtils.lerp(9, 7.0, robotFocus);
    camera.lookAt(THREE.MathUtils.lerp(0.4, 0, robotFocus), 0, 0);

    renderer.render(scene, camera);
  }

  function setScreenText(textVal: StoryBeatText): void {
    if (
      textVal.header === currentText.header &&
      textVal.action === currentText.action &&
      textVal.sub === currentText.sub
    ) {
      return;
    }
    currentText = textVal;
    screenDirty = true;
  }

  function dispose(): void {
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    screenTex.dispose();
    goldTex.dispose();
    creamTex.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  if (reducedMotion) {
    update(0, 0, 0, 0);
  }

  return { renderer, resize, update, setScreenText, dispose };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function setGroupOpacity(group: THREE.Group, opacity: number): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    const mat = mesh.material as THREE.Material & { opacity?: number; transparent?: boolean };
    if (mat && typeof mat.opacity === "number") {
      mat.transparent = true;
      mat.opacity = opacity;
    }
  });
}
