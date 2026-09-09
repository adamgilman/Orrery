/**
 * The box a path actually draws inside, by walking it and sampling every curve. Test-only: the tool never needs
 * this, but a shape that draws outside the unit box it declares breaks everything downstream that trusts the box,
 * so the presets are held to it. Arcs are converted to centre form (SVG F.6.5) and sampled; Béziers are sampled
 * too rather than hull-bounded, so the number is what is drawn rather than a bound on it. A smooth quadratic, T,
 * is sampled as a straight segment to its endpoint; no preset uses one.
 */
export interface Extent { minX: number; minY: number; maxX: number; maxY: number }

const ARITY: Record<string, number> = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 };
const SAMPLES = 96;

export function pathExtent(d: string): Extent {
  const e: Extent = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const at = (x: number, y: number) => { e.minX = Math.min(e.minX, x); e.minY = Math.min(e.minY, y); e.maxX = Math.max(e.maxX, x); e.maxY = Math.max(e.maxY, y); };
  let x = 0, y = 0, startX = 0, startY = 0;
  let prevCubic: [number, number] | undefined;

  for (const m of d.matchAll(/([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g)) {
    const cmd = m[1]!, upper = cmd.toUpperCase(), rel = cmd !== upper;
    const nums = (m[2]!.match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number);
    const arity = ARITY[upper]!;
    const groups = arity ? Math.max(1, Math.floor(nums.length / arity)) : 1;
    for (let g = 0; g < groups; g++) {
      const a = nums.slice(g * arity, g * arity + arity);
      const px = x, py = y;
      const X = (v: number) => (rel ? px + v : v), Y = (v: number) => (rel ? py + v : v);
      if (upper === "M") { x = X(a[0]!); y = Y(a[1]!); startX = x; startY = y; at(x, y); }
      else if (upper === "L" || upper === "T") { x = X(a[0]!); y = Y(a[1]!); at(x, y); }
      else if (upper === "H") { x = X(a[0]!); at(x, y); }
      else if (upper === "V") { y = Y(a[0]!); at(x, y); }
      else if (upper === "C" || upper === "S" || upper === "Q") {
        let c1: [number, number], c2: [number, number], end: [number, number];
        if (upper === "C") { c1 = [X(a[0]!), Y(a[1]!)]; c2 = [X(a[2]!), Y(a[3]!)]; end = [X(a[4]!), Y(a[5]!)]; }
        else if (upper === "S") { c1 = prevCubic ? [2 * px - prevCubic[0], 2 * py - prevCubic[1]] : [px, py]; c2 = [X(a[0]!), Y(a[1]!)]; end = [X(a[2]!), Y(a[3]!)]; }
        else { const q: [number, number] = [X(a[0]!), Y(a[1]!)]; end = [X(a[2]!), Y(a[3]!)]; c1 = [px + (2 / 3) * (q[0] - px), py + (2 / 3) * (q[1] - py)]; c2 = [end[0] + (2 / 3) * (q[0] - end[0]), end[1] + (2 / 3) * (q[1] - end[1])]; }
        for (let i = 0; i <= SAMPLES; i++) {
          const t = i / SAMPLES, u = 1 - t;
          at(u * u * u * px + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0],
             u * u * u * py + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1]);
        }
        prevCubic = c2; x = end[0]; y = end[1];
      } else if (upper === "A") {
        const [rx0, ry0, rot, large, sweep] = [a[0]!, a[1]!, a[2]!, a[3]!, a[4]!];
        const ex = X(a[5]!), ey = Y(a[6]!);
        arcPoints(px, py, Math.abs(rx0), Math.abs(ry0), rot, large !== 0, sweep !== 0, ex, ey, at);
        x = ex; y = ey;
      } else if (upper === "Z") { x = startX; y = startY; at(x, y); }
      if (upper !== "C" && upper !== "S") prevCubic = undefined;
    }
  }
  return e;
}

/** An elliptical arc, endpoint form to centre form, sampled. The bulge is what a straight bounding box misses. */
function arcPoints(x1: number, y1: number, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean, x2: number, y2: number, at: (x: number, y: number) => void): void {
  if (!rx || !ry || (x1 === x2 && y1 === y2)) { at(x2, y2); return; }
  const rot = (rotDeg * Math.PI) / 180, cos = Math.cos(rot), sin = Math.sin(rot);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
  const denom = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const factor = Math.sqrt(Math.max(0, (rx * rx * ry * ry - denom) / denom)) * (large === sweep ? -1 : 1);
  const cxp = (factor * rx * y1p) / ry, cyp = (-factor * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const s = Math.sign(ux * vy - uy * vx) || 1;
    return s * Math.acos(Math.min(1, Math.max(-1, (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy)))));
  };
  const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry, vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
  const theta = angle(1, 0, ux, uy);
  let delta = angle(ux, uy, vx, vy);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = theta + (delta * i) / SAMPLES;
    at(cx + cos * rx * Math.cos(t) - sin * ry * Math.sin(t), cy + sin * rx * Math.cos(t) + cos * ry * Math.sin(t));
  }
}
