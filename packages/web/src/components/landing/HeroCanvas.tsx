import { useEffect, useRef } from "react";

/**
 * Lightweight hero backdrop: a sparse lattice of points that drifts slowly
 * and brightens near the pointer. Hand-written canvas 2D, no dependency —
 * replaces the previous external-video backdrop (a third-party asset URL,
 * the same reliability class of risk the font links had) and stays well
 * inside the 300KB gzip JS budget that would rule out a WebGL library.
 *
 * Respects prefers-reduced-motion (renders one static frame, no rAF loop)
 * and pauses entirely when the tab is hidden.
 */
export default function HeroCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reducedMotion =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let points: { x: number; y: number; vx: number; vy: number; r: number }[] = [];
    const pointer = { x: -9999, y: -9999, active: false };
    let frame = 0;
    let rafId = 0;

    function seed() {
      const area = width * height;
      const count = Math.min(90, Math.max(28, Math.round(area / 22000)));
      points = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        r: 1 + Math.random() * 1.4,
      }));
    }

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }

    function draw() {
      ctx!.clearRect(0, 0, width, height);
      const maxDist = Math.min(160, width * 0.14);

      for (const p of points) {
        if (!reducedMotion) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0 || p.x > width) p.vx *= -1;
          if (p.y < 0 || p.y > height) p.vy *= -1;
        }
      }

      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const a = points[i]!;
          const b = points[j]!;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > maxDist) continue;
          const nearPointer = pointer.active
            ? 1 -
              Math.min(1, Math.hypot((a.x + b.x) / 2 - pointer.x, (a.y + b.y) / 2 - pointer.y) / 220)
            : 0;
          const alpha = (1 - dist / maxDist) * (0.06 + nearPointer * 0.18);
          ctx!.strokeStyle = `rgba(78, 230, 184, ${alpha})`;
          ctx!.lineWidth = 1;
          ctx!.beginPath();
          ctx!.moveTo(a.x, a.y);
          ctx!.lineTo(b.x, b.y);
          ctx!.stroke();
        }
      }

      for (const p of points) {
        const d = pointer.active ? Math.hypot(p.x - pointer.x, p.y - pointer.y) : Infinity;
        const near = Math.max(0, 1 - d / 200);
        ctx!.fillStyle = `rgba(243, 241, 234, ${0.18 + near * 0.55})`;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r + near * 1.2, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    function tick() {
      frame += 1;
      draw();
      if (!reducedMotion) rafId = requestAnimationFrame(tick);
    }

    function onPointerMove(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      pointer.active = true;
    }
    function onPointerLeave() {
      pointer.active = false;
    }
    function onVisibility() {
      if (document.hidden) {
        cancelAnimationFrame(rafId);
      } else if (!reducedMotion) {
        rafId = requestAnimationFrame(tick);
      }
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    draw();
    if (!reducedMotion) rafId = requestAnimationFrame(tick);

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className="lp-hero-canvas" aria-hidden="true" />;
}
