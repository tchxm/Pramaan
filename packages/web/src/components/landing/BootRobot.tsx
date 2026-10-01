import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * A small 3D robot companion for the boot gate — a rounded head with a
 * glowing visor that tracks the pointer and blinks. Built from primitive
 * geometries + a canvas-texture face (the same lightweight technique
 * HeroGlobe uses for its glow sprites), not a bespoke shader/physics
 * character like the reference — that level of custom 3D asset work isn't
 * achievable at production quality in the time available, and a rushed
 * attempt would look worse than no character at all. This is scoped to be
 * small, reliable, and still give the gate real character presence.
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
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    camera.position.set(0, 0.1, 5.2);

    scene.add(new THREE.HemisphereLight(0x184339, 0x02110d, 0.9));
    const key = new THREE.DirectionalLight(0x4ee6b8, 1.4);
    key.position.set(-2, 3, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x4ee6b8, 1.1);
    rim.position.set(3, -1, -2);
    scene.add(rim);

    const headGroup = new THREE.Group();
    scene.add(headGroup);

    const shell = new THREE.MeshStandardMaterial({ color: 0x0d1a17, metalness: 0.55, roughness: 0.4 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x4ee6b8, metalness: 0.7, roughness: 0.3, emissive: 0x0e4336, emissiveIntensity: 0.4 });

    const head = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 48), shell);
    head.scale.set(1, 1.04, 0.95);
    headGroup.add(head);

    // Visor band
    const visorRing = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.045, 16, 48, Math.PI * 1.1), trim);
    visorRing.rotation.set(0, 0, Math.PI * 0.95);
    visorRing.position.set(0, 0.03, 0.78);
    headGroup.add(visorRing);

    // Face screen (canvas texture, same technique as HeroGlobe's glow sprites)
    const faceCanvas = document.createElement("canvas");
    faceCanvas.width = 256;
    faceCanvas.height = 160;
    const fctx = faceCanvas.getContext("2d")!;
    const faceTex = new THREE.CanvasTexture(faceCanvas);
    const faceMat = new THREE.MeshBasicMaterial({ map: faceTex, transparent: true });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.5), faceMat);
    face.position.set(0, 0.18, 1.0);
    headGroup.add(face);

    // Small antenna
    const antenna = new THREE.Group();
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.42, 10), trim);
    stalk.position.y = 0.21;
    antenna.add(stalk);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 16), trim);
    tip.position.y = 0.44;
    antenna.add(tip);
    antenna.position.set(0, 0.95, 0.05);
    headGroup.add(antenna);

    // Ear pods
    for (const side of [-1, 1]) {
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 24), trim);
      pod.rotation.z = Math.PI / 2;
      pod.position.set(side * 0.92, 0, 0);
      headGroup.add(pod);
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

    let blinkAt = 2 + Math.random() * 3;
    let blinkUntil = 0;

    function drawFace(t: number, blinking: boolean) {
      fctx.clearRect(0, 0, 256, 160);
      const eyeY = 80;
      const eyeH = blinking ? 4 : 40;
      fctx.shadowColor = "#9ff7dd";
      fctx.shadowBlur = 30;
      fctx.fillStyle = "#c8fff0";
      for (const cx of [84, 172]) {
        fctx.fillRect(cx - 24, eyeY - eyeH / 2, 48, eyeH);
      }
      fctx.shadowBlur = 0;
      faceTex.needsUpdate = true;
    }

    let raf = 0;
    let t = 0;
    function tick() {
      t += 0.016;
      const isEntering = enteringRef.current;
      const targetY = reducedMotion || isEntering ? 0 : pointer.x * 0.5;
      const targetX = reducedMotion || isEntering ? 0 : -pointer.y * 0.22;
      headGroup.rotation.y += (targetY - headGroup.rotation.y) * 0.06;
      headGroup.rotation.x += (targetX - headGroup.rotation.x) * 0.06;
      headGroup.position.y = reducedMotion || isEntering ? headGroup.position.y * 0.9 : Math.sin(t * 1.1) * 0.06;

      // "Enter" dollies the camera straight through the robot's visor —
      // this is the camera half of the robot-to-globe handoff: BootGate
      // flashes white at the dolly's peak, then unmounts this scene and
      // reveals HeroGlobe already rendering behind it, so the cut reads as
      // one continuous push rather than a hard swap between two scenes.
      const targetZ = isEntering ? 1.22 : 5.2;
      const targetFov = isEntering ? 62 : 32;
      camera.position.z += (targetZ - camera.position.z) * (isEntering ? 0.12 : 0.06);
      camera.fov += (targetFov - camera.fov) * (isEntering ? 0.12 : 0.06);
      camera.updateProjectionMatrix();
      trim.emissiveIntensity = isEntering ? Math.min(2.2, trim.emissiveIntensity + 0.08) : 0.4;

      if (!reducedMotion) {
        if (t > blinkAt) {
          blinkUntil = t + 0.12;
          blinkAt = t + 2.5 + Math.random() * 3;
        }
        drawFace(t, t < blinkUntil);
      } else if (t < 0.1) {
        drawFace(t, false);
      }

      renderer.render(scene, camera);
      if (!reducedMotion) raf = requestAnimationFrame(tick);
    }

    function onVisibility() {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (!reducedMotion) raf = requestAnimationFrame(tick);
    }
    document.addEventListener("visibilitychange", onVisibility);

    drawFace(0, false);
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
      faceTex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={mountRef} className="lp-gate__robot" aria-hidden="true" />;
}
