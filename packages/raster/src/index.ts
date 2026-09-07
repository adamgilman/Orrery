import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { XMLValidator } from "fast-xml-parser";
import { PNG } from "pngjs";
import { FLOW_PERIOD, PULSE_MIN_OPACITY, PULSE_PERIOD, flowDuration } from "@orrery-diagrams/core/internal";
import { freezeTracks } from "./keyframes.js";
export { freezeTracks, parseKeyframes, valuesAt } from "./keyframes.js";

const FONT_FILES = ["Inter-Regular.ttf", "Inter-Medium.ttf"].map((f) => join(import.meta.dirname, "../fonts", f));

/** Index just past the `</g>` that closes the <g> opening at `start`. */
function closeOf(svg: string, start: number): number {
  let depth = 0;
  const re = /<g[\s>]|<\/g>/g;
  re.lastIndex = start;
  for (let m = re.exec(svg); m; m = re.exec(svg)) {
    depth += m[0] === "</g>" ? -1 : 1;
    if (depth === 0) return m.index + 4;
  }
  return svg.length;
}
/** Remove a balanced <g ...>...</g> element starting at `start`. */
const dropElement = (svg: string, start: number): string => svg.slice(0, start) + svg.slice(closeOf(svg, start));
/** Remove the tags of a balanced <g ...>...</g> starting at `start`, keeping what is inside. */
function unwrapElement(svg: string, start: number): string {
  const end = closeOf(svg, start), open = svg.indexOf(">", start) + 1;
  return svg.slice(0, start) + svg.slice(open, end - 4) + svg.slice(end);
}

/**
 * Reduce an interactive document to what a viewer sees inside <img>: the visible view only, no scripts.
 * Idempotent; every pixel-level check runs on this.
 */
export function activeView(svg: string): string {
  // Scripts are always the last children of the root, so everything from the first <script to </svg> goes.
  const scriptAt = svg.indexOf("<script");
  let out = scriptAt >= 0 ? svg.slice(0, scriptAt).trimEnd() + "\n</svg>\n" : svg;
  // Hidden layers carry their style right after the class (the renderer guarantees the attribute order).
  const hidden = '<g class="view" style="display:none"';
  for (let i = out.indexOf(hidden); i >= 0; i = out.indexOf(hidden, i)) out = dropElement(out, i);
  // A playing view stacks one layer per step, a tour one per view; the still picture is the first.
  const steps = /<g class="(?:step|tour)" data-(?:step|frame)="(\d+)"/g;
  for (let m = steps.exec(out); m; m = steps.exec(out)) if (m[1] !== "0") { out = dropElement(out, m.index); steps.lastIndex = m.index; }
  // A one-drawing tour marks everything it shows per scene with whether it is visible at t = 0; the still keeps
  // what is, and unwraps the tour's own wrappers so the checks see ordinary elements.
  const hiddenAt0 = /<(g|text) [^>]*data-t0="0"/g;
  for (let m = hiddenAt0.exec(out); m; m = hiddenAt0.exec(out)) {
    if (m[1] === "g") out = dropElement(out, m.index);
    else out = out.slice(0, m.index) + out.slice(out.indexOf("</text>", m.index) + 7).replace(/^\n/, "");
    hiddenAt0.lastIndex = m.index;
  }
  for (const cls of ["entity", "variant", "shown", "detail", "legend-variant"]) {
    const wrap = `<g class="${cls}`; // a prefix: variants carry their state class too
    for (let i = out.indexOf(wrap); i >= 0; i = out.indexOf(wrap, i)) out = unwrapElement(out, i);
  }
  out = out.replace(/<g class="edges" data-edges="\d+" data-t0="1" style="[^"]*">/g, '<g class="edges">');
  out = out.replace(/ data-t0="[01]"/g, "");
  // The still is the resting picture: every static attribute already holds the t = 0 value, so the tracks go.
  out = out.replace(/ style="animation:orrery-(?!flow|pulse)[\w-]+ [\d.]+s (?:linear|step-end) infinite"/g, "");
  return out;
}

const FLOW_RE = /<path class="flow" data-flow="([^"]+)" data-load="([^"]+)" d="([^"]+)" style="([^"]*)"\/>/g;
const fmt = (n: number) => { const r = Math.round(n * 1000) / 1000; return String(r === 0 ? 0 : r); };

/**
 * Freeze the shipped animated SVG at time t (ms). The CSS animation shifts `stroke-dashoffset` from 0 to
 * -FLOW_PERIOD over each edge's declared duration, so the exact static offset is a closed-form function of t.
 * Everything else is left byte for byte, so frames test the artifact that ships.
 */
export function freezeFrame(svg: string, tMs: number): string {
  svg = freezeTracks(svg, tMs);
  // Pulse: linear triangle wave on stroke-opacity, shared by every pulsing state, so one static value suffices.
  const phase = (tMs / (PULSE_PERIOD * 1000)) % 1;
  const tri = 1 - Math.abs(2 * phase - 1);
  const opacity = 1 - (1 - PULSE_MIN_OPACITY) * tri;
  svg = svg.replaceAll(`animation:orrery-pulse ${PULSE_PERIOD}s linear infinite`, `stroke-opacity:${fmt(opacity)}`);
  return svg.replace(FLOW_RE, (whole, key: string, load: string, d: string, style: string) => {
    const m = style.match(/animation-duration:([\d.]+)s/);
    if (!m) return whole;
    const durationMs = Number(m[1]) * 1000;
    // Deliberately not wrapped: at t = duration the offset is a full -FLOW_PERIOD, so comparing that frame
    // with t = 0 proves the rasterised dash pattern really has that period instead of assuming it.
    const offset = -FLOW_PERIOD * (tMs / durationMs);
    const frozen = style.replace(/animation-duration:[\d.]+s/, `animation:none;stroke-dashoffset:${fmt(offset)}`);
    return `<path class="flow" data-flow="${key}" data-load="${load}" d="${d}" style="${frozen}"/>`;
  });
}

/** Hold every pulse at full opacity so a check of something else is not disturbed by it. */
const stillPulse = (svg: string) => svg.replaceAll(`animation:orrery-pulse ${PULSE_PERIOD}s linear infinite`, "stroke-opacity:1");

/** Drop every flow overlay except `key`, so one edge's animation can be judged without neighbours interfering. */
export function isolateFlow(svg: string, key: string): string {
  return svg.replace(FLOW_RE, (whole, k: string) => (k === key ? whole : ""));
}

export interface RasterOptions { scale?: number; background?: string }

/** SVG string to PNG bytes with a bundled font, so output is identical on every machine. */
export function rasterize(svg: string, { scale = 1, background = "#ffffff" }: RasterOptions = {}): Buffer {
  const png = (s: string) => Buffer.from(new Resvg(s, {
    fitTo: { mode: "zoom", value: scale },
    background,
    font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: "Inter", sansSerifFamily: "Inter" },
  }).render().asPng());
  const full = fullCanvas(svg);
  if (!full) return png(svg);
  // A cropped picture (a zoomed export) is drawn whole and cut to its viewBox in pixels: resvg 2.6 aborts the
  // process on any element that needs its own layer (a marker, a nested icon, a text run with a fallback glyph)
  // when it lies wholly outside the canvas, and a crop leaves most of the drawing outside. The layer records
  // the drawing's size, so the whole is known; the cut is exact at the raster's scale.
  const vb = viewBoxOf(svg);
  const whole = decodePng(png(svg.replace(/viewBox="[^"]*"/, `viewBox="0 0 ${full.width} ${full.height}"`).replace(/ width="[^"]*" height="[^"]*"/, ` width="${full.width}" height="${full.height}"`)));
  return cropPng(whole, { x: Math.round(vb.x * scale), y: Math.round(vb.y * scale), width: Math.round(vb.width * scale), height: Math.round(vb.height * scale) });
}
/** The drawing's whole extent when the viewBox shows less of it, from the active layer's recorded size; undefined when the viewBox already shows it all. */
function fullCanvas(svg: string): { width: number; height: number } | undefined {
  const vb = viewBoxOf(svg);
  const size = svg.match(/<g class="view"[^>]* data-size="([\d.]+) ([\d.]+)"/);
  if (!size) return undefined;
  const top = Number(svg.match(/<g class="scene" transform="translate\(0 ([\d.]+)\)"/)?.[1] ?? 0); // a heading above the scene
  const width = Math.max(Number(size[1]), vb.x + vb.width), height = Math.max(top + Number(size[2]), vb.y + vb.height);
  return vb.x === 0 && vb.y === 0 && vb.width >= width && vb.height >= height ? undefined : { width, height };
}
/** A region of a bitmap as PNG bytes. */
export function cropPng(b: Bitmap, r: Rect): Buffer {
  const out = new PNG({ width: r.width, height: r.height });
  for (let y = 0; y < r.height; y++) {
    const sy = r.y + y;
    if (sy < 0 || sy >= b.height) continue;
    const from = (sy * b.width + Math.max(0, r.x)) * 4, len = Math.max(0, Math.min(r.width, b.width - Math.max(0, r.x))) * 4;
    b.data.copy(out.data, (y * r.width + Math.max(0, -r.x)) * 4, from, from + len);
  }
  return PNG.sync.write(out);
}

export interface Bitmap { width: number; height: number; data: Buffer }
export const decodePng = (png: Buffer): Bitmap => { const p = PNG.sync.read(png); return { width: p.width, height: p.height, data: p.data }; };

export interface Region extends Rect { load: number; durationMs: number }

/** Padded, scaled bounding box of every flow path, keyed by connection key. */
/** Whether the segment a-b, in picture coordinates, meets the rectangle (0, 0, w, h): Liang-Barsky. */
function segmentMeets(a: { x: number; y: number }, b: { x: number; y: number }, w: number, h: number): boolean {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x], [dx, w - a.x], [-dy, a.y], [dy, h - a.y]] as const) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}
/** The picture's viewBox: a zoomed export starts away from the origin, and pixels are measured from where it starts. */
export function viewBoxOf(svg: string): { x: number; y: number; width: number; height: number } {
  const m = svg.match(/viewBox="([\d.-]+) ([\d.-]+) ([\d.]+) ([\d.]+)"/);
  return m ? { x: Number(m[1]), y: Number(m[2]), width: Number(m[3]), height: Number(m[4]) } : { x: 0, y: 0, width: 0, height: 0 };
}
export function flowRegions(svg: string, scale = 1): Record<string, Region> {
  svg = activeView(svg);
  const vb = viewBoxOf(svg), { x: ox, y: oy } = vb;
  const out: Record<string, Region> = {};
  for (const m of svg.matchAll(FLOW_RE)) {
    const [, key, load, d, style] = m;
    const pts = [...d!.matchAll(/([ML])([\d.-]+) ([\d.-]+)/g)].map((p) => ({ x: Number(p[2]) - ox, y: Number(p[3]) - oy }));
    if (pts.length === 0) continue;
    // a flow whose line never enters the picture is not in it: a zoomed export crops most away, and a box that merely
    // touches the crop with a corner of its bounding box has nothing that could move
    const pad = 8;
    if (vb.width && !pts.some((p, i) => i > 0 && segmentMeets({ x: pts[i - 1]!.x + pad, y: pts[i - 1]!.y + pad }, { x: p.x + pad, y: p.y + pad }, vb.width + 2 * pad, vb.height + 2 * pad))) continue;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    // clipped to the picture: a zoomed export leaves some flows partly or wholly outside, and those pixels do not exist
    const x0 = Math.max(0, Math.min(...xs) - pad), y0 = Math.max(0, Math.min(...ys) - pad);
    const x1 = Math.min(vb.width || Infinity, Math.max(...xs) + pad), y1 = Math.min(vb.height || Infinity, Math.max(...ys) + pad);
    if (x1 <= x0 || y1 <= y0) continue;
    const dur = style!.match(/animation-duration:([\d.]+)s/);
    out[key!] = {
      x: Math.floor(x0 * scale),
      y: Math.floor(y0 * scale),
      width: Math.ceil((x1 - x0) * scale),
      height: Math.ceil((y1 - y0) * scale),
      load: Number(load),
      durationMs: dur ? Number(dur[1]) * 1000 : 0,
    };
  }
  return out;
}

export interface Rect { x: number; y: number; width: number; height: number }

/** Padded, scaled box of every pulsing entity (any state whose look pulses), keyed by id. */
export function pulseRegions(svg: string, scale = 1): Record<string, Rect> {
  svg = activeView(svg);
  const { x: ox, y: oy } = viewBoxOf(svg);
  const out: Record<string, Rect> = {};
  const pad = 6;
  for (const m of svg.matchAll(/<g class="(?:node|group) [^>]*>/g)) {
    const tag = m[0];
    if (!tag.includes('data-pulse="1"')) continue;
    const id = tag.match(/data-(?:node|group)="([^"]+)"/)?.[1];
    const bb = tag.match(/data-bbox="([\d.-]+) ([\d.-]+) ([\d.]+) ([\d.]+)"/);
    if (!id || !bb) continue;
    const x0 = Math.max(0, Number(bb[1]) - ox - pad), y0 = Math.max(0, Number(bb[2]) - oy - pad);
    out[id] = { x: Math.floor(x0 * scale), y: Math.floor(y0 * scale), width: Math.ceil((Number(bb[3]) + 2 * pad) * scale), height: Math.ceil((Number(bb[4]) + 2 * pad) * scale) };
  }
  return out;
}

/** True when every pixel inside the region is identical in both bitmaps. */
export function regionEquals(a: Bitmap, b: Bitmap, r: { x: number; y: number; width: number; height: number }): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  const x1 = Math.min(a.width, r.x + r.width), y1 = Math.min(a.height, r.y + r.height);
  for (let y = r.y; y < y1; y++) {
    const start = (y * a.width + r.x) * 4, end = (y * a.width + x1) * 4;
    if (!a.data.subarray(start, end).equals(b.data.subarray(start, end))) return false;
  }
  return true;
}

export interface FrameDiff {
  /** Pixels whose RGBA differs at all (exact comparison; renders are deterministic). */
  changed: number;
  /** Changed pixels not covered by any `allowed` rect. Anything static that moves shows up here. */
  outside: number;
  bbox: Rect | null;
  /** Visual: frame `a` faded to light grey with every changed pixel painted red. */
  image: Bitmap;
}

/** Subtract two frames. The mask is exact; the image is for looking at. */
export function diffFrames(a: Bitmap, b: Bitmap, { allowed = [] as Rect[] } = {}): FrameDiff {
  if (a.width !== b.width || a.height !== b.height) throw new Error("diffFrames: frame sizes differ");
  const { width, height } = a;
  const image = Buffer.alloc(width * height * 4);
  let changed = 0, outside = 0, x0 = width, y0 = height, x1 = -1, y1 = -1;
  const inAllowed = (x: number, y: number) => allowed.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const same = a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] && a.data[i + 2] === b.data[i + 2] && a.data[i + 3] === b.data[i + 3];
    if (same) {
      const grey = 255 - Math.round((255 - (a.data[i]! * 0.299 + a.data[i + 1]! * 0.587 + a.data[i + 2]! * 0.114)) * 0.15);
      image[i] = grey; image[i + 1] = grey; image[i + 2] = grey; image[i + 3] = 255;
    } else {
      changed++;
      if (!inAllowed(x, y)) outside++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      image[i] = 255; image[i + 1] = 0; image[i + 2] = 0; image[i + 3] = 255;
    }
  }
  return { changed, outside, bbox: changed ? { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 } : null, image: { width, height, data: image } };
}

export const encodePng = (bm: Bitmap): Buffer => { const p = new PNG({ width: bm.width, height: bm.height }); bm.data.copy(p.data); return PNG.sync.write(p); };

export interface FrameOptions extends RasterOptions { times?: number[]; fps?: number; durationMs?: number }
export interface Frame { tMs: number; png: Buffer }

/** Rasterise the animation at explicit times, or at `fps` over `durationMs` (end exclusive). */
export function renderFrames(svg: string, opts: FrameOptions = {}): Frame[] {
  const { fps = 10, durationMs = 1000, scale, background } = opts;
  const times = opts.times ?? Array.from({ length: Math.floor((durationMs * fps) / 1000) }, (_, i) => (i * 1000) / fps);
  const ro: RasterOptions = { ...(scale !== undefined ? { scale } : {}), ...(background !== undefined ? { background } : {}) };
  return times.map((tMs) => ({ tMs, png: rasterize(freezeFrame(svg, tMs), ro) }));
}

/** Tile equally sized PNG frames into one image an agent can look at in a single glance. */
export function contactSheet(frames: Buffer[], { columns = 4, gutter = 4 }: { columns?: number; gutter?: number } = {}): Buffer {
  const bitmaps = frames.map(decodePng);
  const w = bitmaps[0]?.width ?? 0, h = bitmaps[0]?.height ?? 0;
  const rows = Math.ceil(bitmaps.length / columns);
  const sheet = new PNG({ width: columns * w + gutter * (columns + 1), height: rows * h + gutter * (rows + 1) });
  sheet.data.fill(0xe2); // light gutter
  for (let i = 3; i < sheet.data.length; i += 4) sheet.data[i] = 0xff;
  bitmaps.forEach((bm, i) => {
    const ox = gutter + (i % columns) * (w + gutter), oy = gutter + Math.floor(i / columns) * (h + gutter);
    for (let y = 0; y < bm.height; y++) bm.data.copy(sheet.data, ((oy + y) * sheet.width + ox) * 4, y * bm.width * 4, (y + 1) * bm.width * 4);
  });
  return PNG.sync.write(sheet);
}

export interface ConnectionReport { key: string; load: number; durationMs: number; periodic: boolean; moving: boolean }
export interface StepReport { fromMs: number; toMs: number; changed: number; outside: number }
export interface InspectReport {
  ok: boolean;
  xml: { ok: boolean; error?: string };
  size: { width: number; height: number };
  connections: ConnectionReport[];
  /** Consecutive-frame subtraction over the whole diagram at `fps` for `durationMs`. */
  steps: StepReport[];
  problems: string[];
}
export interface InspectOptions { scale?: number; fps?: number; durationMs?: number }

/**
 * Validate a rendered SVG without a browser: well-formed XML, and for every edge, that the frozen frame
 * at t = duration equals t = 0 (timing matches the declared constant) and t = duration/2 differs (it moves).
 */
export function inspect(svg: string, { scale = 1, fps = 10, durationMs = 1000 }: InspectOptions = {}): InspectReport {
  const v = XMLValidator.validate(svg);
  svg = activeView(svg);
  const xml = v === true ? { ok: true } : { ok: false, error: v.err.msg };
  const vb = viewBoxOf(svg);
  const size = { width: vb.width, height: vb.height };
  const problems: string[] = [];
  if (!xml.ok) problems.push(`malformed XML: ${xml.error}`);
  const connections: ConnectionReport[] = [];
  const steps: StepReport[] = [];
  if (xml.ok) {
    const regions = flowRegions(svg, scale);
    // Whole-diagram subtraction: every changed pixel must sit inside a flow region or a pulsing failed node.
    const allowed = [...Object.values(regions), ...Object.values(pulseRegions(svg, scale))];
    const seq = renderFrames(svg, { fps, durationMs, scale });
    const bitmaps = seq.map((f) => decodePng(f.png));
    for (let i = 1; i < bitmaps.length; i++) {
      const d = diffFrames(bitmaps[i - 1]!, bitmaps[i]!, { allowed });
      steps.push({ fromMs: seq[i - 1]!.tMs, toMs: seq[i]!.tMs, changed: d.changed, outside: d.outside });
      if (d.outside > 0) problems.push(`${d.outside} pixels changed outside any flow or pulsing entity between t=${seq[i - 1]!.tMs}ms and t=${seq[i]!.tMs}ms: something static is moving`);
    }
    if (Object.values(regions).some((r) => r.load > 0) && steps.length && steps.every((s) => s.changed === 0)) problems.push("no pixel changes between any frames although connections carry load");
    for (const [key, r] of Object.entries(regions)) {
      const alone = stillPulse(isolateFlow(svg, key));
      const frame = (t: number) => decodePng(rasterize(freezeFrame(alone, t), { scale }));
      const d = r.load > 0 ? r.durationMs || flowDuration(r.load) * 1000 : 1000;
      const f0 = frame(0);
      const periodic = regionEquals(f0, frame(d), r);
      const moving = !regionEquals(f0, frame(d / 2), r);
      if (!periodic) problems.push(`${key}: frame at t=${d}ms differs from t=0, timing does not match the declared duration`);
      if (r.load > 0 && !moving) problems.push(`${key}: load ${r.load} but nothing moves between t=0 and t=${d / 2}ms`);
      if (r.load === 0 && moving) problems.push(`${key}: load 0 but pixels change`);
      connections.push({ key, load: r.load, durationMs: d, periodic, moving });
    }
  }
  return { ok: problems.length === 0, xml, size, connections, steps, problems };
}
