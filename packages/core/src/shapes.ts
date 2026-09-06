import type { ShapeDef } from "./types.js";

/** The preset shapes, in the order they are listed. `box` is what a kind without a shape is drawn as. */
export const SHAPE_PRESETS = ["box", "sharp", "pill", "ellipse", "cylinder", "hexagon", "diamond", "parallelogram", "document", "card", "cloud"] as const;

/**
 * Preset outlines. A `corner` shape is a rounded rectangle; a `path` shape is SVG path data in a 100×100 unit box,
 * scaled to the component's size at render time. `pad` is the room the label needs to clear the outline, per side.
 */
export const DEFAULT_SHAPES: Record<(typeof SHAPE_PRESETS)[number], Omit<ShapeDef, "name">> = {
  box: { corner: 8, pad: { x: 0, y: 0 } },
  sharp: { corner: 0, pad: { x: 0, y: 0 } },
  pill: { corner: "round", pad: { x: 6, y: 0 } },
  ellipse: { path: "M50 0A50 50 0 1 1 50 100A50 50 0 1 1 50 0Z", pad: { x: 18, y: 8 } },
  cylinder: { path: "M0 12A50 12 0 0 1 100 12V88A50 12 0 0 1 0 88ZM0 12A50 12 0 0 0 100 12", pad: { x: 6, y: 6 } },
  hexagon: { path: "M15 0H85L100 50 85 100H15L0 50Z", pad: { x: 16, y: 0 } },
  diamond: { path: "M50 0L100 50 50 100 0 50Z", pad: { x: 36, y: 14 } },
  parallelogram: { path: "M15 0H100L85 100H0Z", pad: { x: 14, y: 0 } },
  document: { path: "M0 0H100V84Q75 70 50 84T0 84Z", pad: { x: 0, y: 8 } },
  card: { path: "M12 0H100V100H0V12Z", pad: { x: 4, y: 0 } },
  cloud: { path: "M22 80A18 18 0 0 1 12 48A20 20 0 0 1 40 22A22 22 0 0 1 72 20A18 18 0 0 1 92 46A16 16 0 0 1 84 80Z", pad: { x: 16, y: 12 } },
};

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
