"use client";

import { useEffect, useMemo, useRef, type CSSProperties } from "react";

/**
 * Floating wireframe polyhedron, drawn as one SVG path and rotated in 3D on
 * each animation frame (direct DOM writes, no React re-renders). Purely
 * decorative. Holds a single still frame under prefers-reduced-motion.
 */

type Vec = [number, number, number];
type Geometry = { v: Vec[]; e: [number, number][] };

const PHI = (1 + Math.sqrt(5)) / 2;

/** Scale vertices onto the unit sphere and connect every pair at the shortest distance. */
function fromVertices(raw: Vec[]): Geometry {
  const r = Math.max(...raw.map(([x, y, z]) => Math.hypot(x, y, z)));
  const v = raw.map(([x, y, z]) => [x / r, y / r, z / r] as Vec);
  let min = Infinity;
  const pairs: [number, number, number][] = [];
  for (let i = 0; i < v.length; i++)
    for (let j = i + 1; j < v.length; j++) {
      const d = Math.hypot(v[i][0] - v[j][0], v[i][1] - v[j][1], v[i][2] - v[j][2]);
      pairs.push([i, j, d]);
      min = Math.min(min, d);
    }
  return { v, e: pairs.filter(([, , d]) => d < min * 1.01).map(([i, j]) => [i, j]) };
}

const SHAPES = {
  icosahedron: () =>
    fromVertices([
      [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
      [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
      [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
    ]),
  octahedron: () => fromVertices([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]),
  /** Elongated hexagonal bipyramid — reads like a crystal shard. */
  crystal: (): Geometry => {
    const ring: Vec[] = Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * Math.PI * 2;
      return [Math.cos(a) * 0.55, 0.1, Math.sin(a) * 0.55];
    });
    const v: Vec[] = [...ring, [0, 1, 0], [0, -1, 0]];
    const e: [number, number][] = [];
    for (let i = 0; i < 6; i++) e.push([i, (i + 1) % 6], [i, 6], [i, 7]);
    return { v, e };
  },
} satisfies Record<string, () => Geometry>;

export type WireShape = keyof typeof SHAPES;

const CAMERA = 3.2;
const DOT = 0.028;

function project(g: Geometry, yaw: number, pitch: number) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const pts = g.v.map(([x, y, z]) => {
    const x1 = x * cy + z * sy;
    const z1 = -x * sy + z * cy;
    const y2 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    const s = CAMERA / (CAMERA + z2);
    return [x1 * s, y2 * s] as const;
  });
  const f = (n: number) => n.toFixed(3);
  const edges = g.e.map(([a, b]) => `M${f(pts[a][0])} ${f(pts[a][1])}L${f(pts[b][0])} ${f(pts[b][1])}`).join("");
  const dots = pts
    .map(([x, y]) => `M${f(x - DOT)} ${f(y)}a${DOT} ${DOT} 0 1 0 ${2 * DOT} 0a${DOT} ${DOT} 0 1 0 ${-2 * DOT} 0`)
    .join("");
  return { edges, dots };
}

export function Wireframe({
  shape,
  size,
  speed = 1,
  pitch = 0.45,
  className,
  style,
}: {
  shape: WireShape;
  size: number;
  speed?: number;
  pitch?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const geo = useMemo(() => SHAPES[shape](), [shape]);
  const initial = useMemo(() => project(geo, 0.6, pitch), [geo, pitch]);
  const edgesRef = useRef<SVGPathElement>(null);
  const dotsRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    const t0 = performance.now();
    const draw = (t: number) => {
      const a = 0.6 + ((t - t0) / 1000) * 0.32 * speed;
      const { edges, dots } = project(geo, a, pitch + Math.sin(a * 0.6) * 0.2);
      edgesRef.current?.setAttribute("d", edges);
      dotsRef.current?.setAttribute("d", dots);
      raf = requestAnimationFrame(draw);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      if (!media.matches) raf = requestAnimationFrame(draw);
    };
    start();
    media.addEventListener("change", start);
    return () => {
      cancelAnimationFrame(raf);
      media.removeEventListener("change", start);
    };
  }, [geo, speed, pitch]);

  return (
    <svg
      viewBox="-1.25 -1.25 2.5 2.5"
      width={size}
      height={size}
      className={className}
      style={style}
      aria-hidden
      focusable="false"
    >
      <path
        ref={edgesRef}
        d={initial.edges}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <path ref={dotsRef} d={initial.dots} fill="currentColor" />
    </svg>
  );
}
