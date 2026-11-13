import type { ShapeDef } from "./types.js";

/** The preset shapes, in the order they are listed. `box` is what a kind without a shape is drawn as. */
export const SHAPE_PRESETS = ["box", "sharp", "pill", "ellipse", "cylinder", "hexagon", "diamond", "parallelogram", "document", "card", "cloud"] as const;

/**
 * Preset outlines. A `corner` shape is a rounded rectangle; a `path` shape is SVG path data in a 100×100 unit box,
 * scaled to the component's size at render time. `pad` is room round the contents in px per side. `inner` is the
 * rectangle of the unit box the outline leaves clear, where the contents go (R18): every preset whose edge slants
 * or curves into its box declares one, and a test holds each to it.
 */
export const DEFAULT_SHAPES: Record<(typeof SHAPE_PRESETS)[number], Omit<ShapeDef, "name">> = {
  box: { corner: 8, pad: { x: 0, y: 0 } },
  sharp: { corner: 0, pad: { x: 0, y: 0 } },
  pill: { corner: "round", pad: { x: 6, y: 0 } },
  ellipse: { path: "M50 0A50 50 0 1 1 50 100A50 50 0 1 1 50 0Z", pad: { x: 18, y: 8 }, inner: [11, 21, 89, 79] },
  cylinder: { path: "M0 12A50 12 0 0 1 100 12V88A50 12 0 0 1 0 88ZM0 12A50 12 0 0 0 100 12", pad: { x: 6, y: 6 } },
  hexagon: { path: "M15 0H85L100 50 85 100H15L0 50Z", pad: { x: 16, y: 0 }, inner: [10, 17, 90, 83] },
  diamond: { path: "M50 0L100 50 50 100 0 50Z", pad: { x: 36, y: 14 }, inner: [21, 31, 79, 69] },
  parallelogram: { path: "M15 0H100L85 100H0Z", pad: { x: 14, y: 0 }, inner: [13, 15, 87, 85] },
  document: { path: "M0 0H100V84Q75 70 50 84T0 84Z", pad: { x: 0, y: 8 } },
  card: { path: "M12 0H100V100H0V12Z", pad: { x: 4, y: 0 } },
  // Cubic curves, not arcs: a cubic stays inside the hull of its control points under any scaling, so the lobes
  // cannot swell out of the box and through the group frame drawn around the node (issue #31). Its contents go in
  // the body below the lobes: centred in the box they sat on the line between the left and middle lobes (issue #51).
  cloud: { path: "M10 100C2 96 0 82 8 68C4 46 22 34 34 44C36 16 60 0 70 26C80 10 98 20 94 46C100 62 100 86 88 100Z", pad: { x: 26, y: 12 }, inner: [12, 50, 88, 94] },
};

export interface Rect { x: number; y: number; width: number; height: number }

/**
 * Where a shape's contents are drawn in a node of this size (R18): its `inner` rectangle scaled from the unit box,
 * which stays inside the outline however the node is stretched, or without one the box less the shape's `pad`.
 */
export function contentRect(shape: Pick<ShapeDef, "pad" | "inner">, width: number, height: number): Rect {
  if (shape.inner) { const [x0, y0, x1, y1] = shape.inner; return { x: (width * x0) / 100, y: (height * y0) / 100, width: (width * (x1 - x0)) / 100, height: (height * (y1 - y0)) / 100 }; }
  return { x: shape.pad.x, y: shape.pad.y, width: width - 2 * shape.pad.x, height: height - 2 * shape.pad.y };
}

/**
 * The size of a node whose contents are `content` across and down, `lines` of it being what must not touch the
 * outline vertically (the text and marks, less than the box a plain rectangle draws round them). The shape's `pad`
 * on every side, and with an `inner` rectangle no smaller than what makes that rectangle hold the contents: a
 * slanted or curved edge takes a share of the node, not a fixed number of px, so a fixed pad stops being enough as
 * the label grows.
 */
export function shapedSize(shape: Pick<ShapeDef, "pad" | "inner">, content: { width: number; height: number }, lines: number): { width: number; height: number } {
  const width = content.width + 2 * shape.pad.x, height = content.height + 2 * shape.pad.y;
  if (!shape.inner) return { width, height };
  const [x0, y0, x1, y1] = shape.inner;
  return { width: Math.max(width, Math.ceil((content.width * 100) / (x1 - x0))), height: Math.max(height, Math.ceil((lines * 100) / (y1 - y0))) };
}

/** Path data as an author may write it: the absolute and relative forms of M L H V C S Q T A Z, numbers, separators. */
export const PATH_DATA = /^[Mm][MmLlHhVvCcSsQqTtAaZz\d\s.,+-]*$/;
/** How many numbers each command takes, and which of them are x (true) or y (false); arcs are rx ry rot large sweep x y. */
const ARGS: Record<string, boolean[]> = { M: [true, false], L: [true, false], T: [true, false], H: [true], V: [false], C: [true, false, true, false, true, false], S: [true, false, true, false], Q: [true, false, true, false], A: [true, false, null as unknown as boolean, null as unknown as boolean, null as unknown as boolean, true, false], Z: [] };
const num = (n: number) => String(Math.round(n * 10) / 10);

/** Scale path data from the 100×100 unit box to `width`×`height`, coordinate by coordinate, so strokes are not transformed. Arc radii scale with their axes; rotation and flags pass through. */
export function scalePath(d: string, width: number, height: number): string {
  const sx = width / 100, sy = height / 100;
  return d.replace(/([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g, (_, cmd: string, rest: string) => {
    const axes = ARGS[cmd.toUpperCase()]!;
    const nums = rest.match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
    const out = nums.map((n, i) => { const axis = axes[i % axes.length]; return axis === null ? n : num(Number(n) * (axis ? sx : sy)); });
    return cmd + out.join(" ");
  });
}
