import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { XMLValidator } from "fast-xml-parser";
import { PNG } from "pngjs";
import { FLOW_PERIOD, PULSE_MIN_OPACITY, PULSE_PERIOD, flowDuration } from "@orrery/core";

const FONT_FILES = ["Inter-Regular.ttf", "Inter-Medium.ttf"].map((f) => join(import.meta.dirname, "../fonts", f));

/** Remove a balanced <g ...>...</g> element starting at `start`. Returns the string without it. */
function dropElement(svg: string, start: number): string {
  let depth = 0, i = start;
  const re = /<g[\s>]|<\/g>/g;
  re.lastIndex = start;
  for (let m = re.exec(svg); m; m = re.exec(svg)) {
    depth += m[0] === "</g>" ? -1 : 1;
    if (depth === 0) { i = m.index + 4; break; }
  }
  return svg.slice(0, start) + svg.slice(i);
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
  const r = new Resvg(svg, {
    fitTo: { mode: "zoom", value: scale },
    background,
    font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: "Inter", sansSerifFamily: "Inter" },
  });
  return Buffer.from(r.render().asPng());
}

export interface Bitmap { width: number; height: number; data: Buffer }
export const decodePng = (png: Buffer): Bitmap => { const p = PNG.sync.read(png); return { width: p.width, height: p.height, data: p.data }; };

export interface Region extends Rect { load: number; durationMs: number }

/** Padded, scaled bounding box of every flow path, keyed by connection key. */
export function flowRegions(svg: string, scale = 1): Record<string, Region> {
  svg = activeView(svg);
  const out: Record<string, Region> = {};
  for (const m of svg.matchAll(FLOW_RE)) {
    const [, key, load, d, style] = m;
    const pts = [...d!.matchAll(/([ML])([\d.-]+) ([\d.-]+)/g)].map((p) => ({ x: Number(p[2]), y: Number(p[3]) }));
    if (pts.length === 0) continue;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const pad = 8;
    const x0 = Math.max(0, Math.min(...xs) - pad), y0 = Math.max(0, Math.min(...ys) - pad);
    const dur = style!.match(/animation-duration:([\d.]+)s/);
    out[key!] = {
      x: Math.floor(x0 * scale),
      y: Math.floor(y0 * scale),
      width: Math.ceil((Math.max(...xs) + pad - x0) * scale),
      height: Math.ceil((Math.max(...ys) + pad - y0) * scale),
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
  const out: Record<string, Rect> = {};
  const pad = 6;
  for (const m of svg.matchAll(/<g class="(?:node|group) [^>]*>/g)) {
    const tag = m[0];
    if (!tag.includes('data-pulse="1"')) continue;
    const id = tag.match(/data-(?:node|group)="([^"]+)"/)?.[1];
    const bb = tag.match(/data-bbox="([\d.-]+) ([\d.-]+) ([\d.]+) ([\d.]+)"/);
    if (!id || !bb) continue;
    const x0 = Math.max(0, Number(bb[1]) - pad), y0 = Math.max(0, Number(bb[2]) - pad);
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
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const size = { width: vb ? Number(vb[1]) : 0, height: vb ? Number(vb[2]) : 0 };
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
