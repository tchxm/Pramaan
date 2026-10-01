/** Static evidence field for mobile, reduced motion, and unavailable WebGL. */
export default function StaticSignal() {
  const points = Array.from({ length: 80 }, (_, i) => {
    const y = 1 - 2 * (i + 0.5) / 80;
    const r = Math.sqrt(1 - y * y);
    const angle = i * 2.39996;
    return { x: 150 + Math.cos(angle) * r * 126, y: 150 + y * 126, z: Math.sin(angle) * r };
  });
  return <svg className="story__static-signal" viewBox="0 0 300 300" aria-hidden="true">
    {points.flatMap((p, i) => points.slice(i + 1).map((q, j) =>
      Math.hypot(p.x - q.x, p.y - q.y) < 43 && Math.abs(p.z - q.z) < 0.6
        ? <line key={`${i}-${j}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="currentColor" opacity=".16" /> : null))}
    {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={i % 13 === 0 ? 2.2 : 1.2} fill="currentColor" opacity={0.3 + (p.z + 1) * 0.3} />)}
  </svg>;
}
