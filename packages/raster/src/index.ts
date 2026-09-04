import { Resvg } from "@resvg/resvg-js";
import { XMLValidator } from "fast-xml-parser";
import { PNG } from "pngjs";
import { FLOW_PERIOD, flowDuration } from "@orrery/core";

const fontDir = new URL("../fonts/", import.meta.url);
const FONT_FILES = ["Inter-Regular.ttf", "Inter-Medium.ttf"].map((f) => new URL(f, fontDir).pathname);

const FLOW_RE = /<path class="flow" data-flow="([^"]+)" data-load="([^"]+)" d="([^"]+)" style="([^"]*)"\/>/g;
const fmt = (n: number) => { const r = Math.round(n * 1000) / 1000; return String(r === 0 ? 0 : r); };

/**
 * Freeze the shipped animated SVG at time t (ms). The CSS animation shifts `stroke-dashoffset` from 0 to
 * -FLOW_PERIOD over each edge's declared duration, so the exact static offset is a closed-form function of t.
 * Everything else is left byte for byte, so frames test the artifact that ships.
 */
export function freezeFrame(svg: string, tMs: number): string {
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

export interface Region { x: number; y: number; width: number; height: number; load: number; durationMs: number }

/** Padded, scaled bounding box of every flow path, keyed by "from->to". */
export function flowRegions(svg: string, scale = 1): Record<string, Region> {
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

export interface EdgeReport { key: string; load: number; durationMs: number; periodic: boolean; moving: boolean }
export interface InspectReport {
  ok: boolean;
  xml: { ok: boolean; error?: string };
  size: { width: number; height: number };
  edges: EdgeReport[];
  problems: string[];
}

/**
 * Validate a rendered SVG without a browser: well-formed XML, and for every edge, that the frozen frame
 * at t = duration equals t = 0 (timing matches the declared constant) and t = duration/2 differs (it moves).
 */
export function inspect(svg: string, { scale = 1 }: { scale?: number } = {}): InspectReport {
  const v = XMLValidator.validate(svg);
  const xml = v === true ? { ok: true } : { ok: false, error: v.err.msg };
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const size = { width: vb ? Number(vb[1]) : 0, height: vb ? Number(vb[2]) : 0 };
  const problems: string[] = [];
  if (!xml.ok) problems.push(`malformed XML: ${xml.error}`);
  const edges: EdgeReport[] = [];
  if (xml.ok) {
    for (const [key, r] of Object.entries(flowRegions(svg, scale))) {
      const alone = isolateFlow(svg, key);
      const frame = (t: number) => decodePng(rasterize(freezeFrame(alone, t), { scale }));
      const d = r.load > 0 ? r.durationMs || flowDuration(r.load) * 1000 : 1000;
      const f0 = frame(0);
      const periodic = regionEquals(f0, frame(d), r);
      const moving = !regionEquals(f0, frame(d / 2), r);
      if (!periodic) problems.push(`${key}: frame at t=${d}ms differs from t=0, timing does not match the declared duration`);
      if (r.load > 0 && !moving) problems.push(`${key}: load ${r.load} but nothing moves between t=0 and t=${d / 2}ms`);
      if (r.load === 0 && moving) problems.push(`${key}: load 0 but pixels change`);
      edges.push({ key, load: r.load, durationMs: d, periodic, moving });
    }
  }
  return { ok: problems.length === 0, xml, size, edges, problems };
}
