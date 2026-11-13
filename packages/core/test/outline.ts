import { pathExtent } from "./pathExtent.js";
import { scalePath } from "../src/internal.js";
import type { ShapeDef } from "../src/index.js";

/**
 * Whether a point is inside a shape's outline at a size. Test-only, like pathExtent: the tool trusts a shape's
 * declared content rectangle and never asks this, so the presets are held to it here (R18). A path shape is its
 * first subpath, sampled to a polygon (a cylinder's second subpath is its rim, not its edge); a corner shape is a
 * rounded rectangle.
 */
export function insideOutline(shape: Pick<ShapeDef, "path" | "corner">, width: number, height: number): (x: number, y: number) => boolean {
  if (shape.path === undefined) {
    const r = Math.min(shape.corner === "round" ? height / 2 : shape.corner ?? 8, width / 2, height / 2);
    return (x, y) => {
      if (x < 0 || y < 0 || x > width || y > height) return false;
      const cx = Math.min(Math.max(x, r), width - r), cy = Math.min(Math.max(y, r), height - r);
      return Math.hypot(x - cx, y - cy) <= r;
    };
  }
  const subpaths: [number, number][][] = [];
  pathExtent(scalePath(shape.path, width, height), (x, y, start) => { if (start) subpaths.push([]); subpaths.at(-1)!.push([x, y]); });
  const poly = subpaths[0]!;
  return (x, y) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}

export interface Box { what: string; x0: number; y0: number; x1: number; y1: number }

/** The boxes whose border leaves the outline anywhere, by name. A convex box inside a simple outline has its whole border inside. */
export function escaping(isIn: (x: number, y: number) => boolean, boxes: Box[]): string[] {
  const N = 48;
  return boxes.filter((b) => {
    for (let i = 0; i <= N; i++) {
      const x = b.x0 + ((b.x1 - b.x0) * i) / N, y = b.y0 + ((b.y1 - b.y0) * i) / N;
      if (!isIn(x, b.y0) || !isIn(x, b.y1) || !isIn(b.x0, y) || !isIn(b.x1, y)) return true;
    }
    return false;
  }).map((b) => b.what);
}
