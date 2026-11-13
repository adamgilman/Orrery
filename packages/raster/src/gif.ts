/**
 * PNG and GIF of an animated picture (MODEL.md R19). A PNG is the picture at rest; a GIF is one loop of it, every
 * frame the SVG frozen at its moment and rasterised, so both show what the SVG shows and nothing is drawn twice.
 * The GIF writer is here, whole: the format is small, and a picture of flat colours needs little from a quantiser.
 */
import { decodePng, freezeFrame, rasterize, type RasterOptions } from "./index.js";

/** The longest loop chosen for a picture of flows alone, and how far a period may move before a longer loop is preferred. */
export const LOOP_MAX_MS = 8000;
export const LOOP_STRETCH = 0.05;

export interface Loop {
  /** One loop of the picture in milliseconds; 0 when nothing in it moves. */
  durationMs: number;
  /** The largest relative change made to a flow's or the pulse's period so that it completes whole cycles in the loop; 0 when none was needed. */
  stretch: number;
  /** The picture with those periods written in: the frame at `durationMs` is the frame at 0. */
  svg: string;
}

const TRACK = /animation:orrery-(?!flow|pulse)[\w-]+ ([\d.]+)s (?:linear|step-end) infinite/g;
const FLOW = /(<path class="flow" data-flow="[^"]+" data-load="[^"]+" d="[^"]+" style="[^"]*?animation-duration:)([\d.]+)s/g;
const PULSE = /(animation:orrery-pulse )([\d.]+)(s linear infinite)/g;
const ms = (seconds: string) => Math.round(Number(seconds) * 1000);
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
/** The period nearest `period` that divides `loop` into whole cycles. */
const fitted = (period: number, loop: number) => loop / Math.max(1, Math.round(loop / period));
const seconds = (periodMs: number) => String(Math.round(periodMs * 1000) / 1e6);

/**
 * The loop of an animated picture, from the periods written in it. A playing view or a tour has one whole cycle
 * and that is the loop. A picture of flows alone repeats only when every flow has completed whole cycles, which
 * for unrelated loads is minutes away. So the loop is the shortest, up to `maxMs`, in which they all do; failing
 * that the shortest that needs no period moved by more than LOOP_STRETCH; failing that the one that moves them
 * least; and each flow and the pulse is then given the nearest period that fits. Slower stays slower. `durationMs` asks for a length instead.
 */
export function fitLoop(svg: string, { durationMs, maxMs = LOOP_MAX_MS }: { durationMs?: number; maxMs?: number } = {}): Loop {
  const tracks = [...new Set([...svg.matchAll(TRACK)].map((m) => ms(m[1]!)))];
  const pulsing = svg.includes('data-pulse="1"'); // the pulse's rule is in every stylesheet; it counts when something pulses
  const cycles = [...new Set([...[...svg.matchAll(FLOW)].map((m) => ms(m[2]!)), ...(pulsing ? [...svg.matchAll(PULSE)].map((m) => ms(m[2]!)) : [])])];
  const stretchAt = (loop: number) => Math.max(0, ...cycles.map((p) => (loop % p === 0 ? 0 : Math.abs(fitted(p, loop) / p - 1))));
  let loop = durationMs;
  if (loop === undefined && tracks.length) loop = tracks.reduce((a, b) => (a / gcd(a, b)) * b);
  if (loop === undefined) {
    if (!cycles.length) return { durationMs: 0, stretch: 0, svg };
    // in order of preference: the shortest loop every period divides, the shortest that moves none by more than
    // LOOP_STRETCH, the one that moves them least
    let least = Infinity, within: number | undefined;
    const longest = Math.max(...cycles);
    for (let d = Math.ceil(longest / 100) * 100; d <= Math.max(maxMs, longest); d += 100) {
      const s = stretchAt(d);
      if (s === 0) { loop = d; break; }
      if (s <= LOOP_STRETCH) within ??= d;
      if (s < least - 1e-9 && within === undefined) { least = s; loop = d; }
    }
    if (stretchAt(loop!) !== 0 && within !== undefined) loop = within;
  }
  const total = loop!;
  const refit = (period: string) => (total % ms(period) === 0 ? period : seconds(fitted(ms(period), total)));
  const out = svg.replace(FLOW, (_, head: string, p: string) => `${head}${refit(p)}s`).replace(PULSE, (whole, head: string, p: string, tail: string) => (pulsing ? `${head}${refit(p)}${tail}` : whole));
  return { durationMs: total, stretch: stretchAt(total), svg: out };
}

/** The picture at rest as PNG bytes: what an image tag shows at the moment it loads. */
export const renderPng = (svg: string, options: RasterOptions = {}): Buffer => rasterize(freezeFrame(svg, 0), options);

const pixels = (png: Buffer) => {
  const { width, height, data } = decodePng(png);
  // a view of whole pixels as numbers; copied when the buffer does not start on a word
  const whole = data.byteOffset % 4 === 0 ? data : Buffer.from(Uint8Array.from(data).buffer);
  return { width, height, colours: new Uint32Array(whole.buffer, whole.byteOffset, width * height) };
};
type Rgb = [number, number, number];
const rgb = (c: number): Rgb => [c & 255, (c >> 8) & 255, (c >> 16) & 255];

/**
 * At most 255 colours for these counted ones, and where each goes. A picture with that few keeps them all.
 * Otherwise a median cut: the colours start as one box, and the box with the most spread and use is cut in two
 * at its median along its longest side until there are 255. Each box is then stood for by the most used real
 * colour in it, not an average, so the white of the page, a fill and a line are exactly themselves and only the
 * shades along edges are approximated; every colour goes to the nearest of those.
 */
function paletteOf(counts: Map<number, number>): { palette: Rgb[]; indexOf: Map<number, number> } {
  const colours = [...counts.keys()].sort((a, b) => a - b);
  let chosen = colours;
  if (colours.length > 255) {
    const weight = (c: number) => Math.sqrt(counts.get(c)!);
    const box = (members: number[]) => {
      const lo = [255, 255, 255], hi = [0, 0, 0];
      for (const c of members) rgb(c).forEach((v, k) => { if (v < lo[k]!) lo[k] = v; if (v > hi[k]!) hi[k] = v; });
      const spread = hi.map((v, k) => v - lo[k]!);
      const axis = spread.indexOf(Math.max(...spread));
      const total = members.reduce((sum, c) => sum + weight(c), 0);
      return { members, axis, total, score: spread[axis]! * Math.sqrt(total) };
    };
    const boxes = [box(colours)];
    while (boxes.length < 255) {
      let widest = 0;
      boxes.forEach((b, k) => { if (b.score > boxes[widest]!.score) widest = k; });
      const { members, axis, total, score } = boxes[widest]!;
      if (score === 0) break;
      const along = [...members].sort((a, b) => rgb(a)[axis]! - rgb(b)[axis]! || a - b);
      let cut = 1;
      for (let sum = weight(along[0]!); cut < along.length - 1 && sum < total / 2; cut++) sum += weight(along[cut]!);
      // a cut never separates two colours with the same value on the axis from nothing: both halves are non-empty
      boxes.splice(widest, 1, box(along.slice(0, cut)), box(along.slice(cut)));
    }
    chosen = boxes.map((b) => b.members.reduce((best, c) => (counts.get(c)! > counts.get(best)! ? c : best))).sort((a, b) => a - b);
  }
  const palette = chosen.map(rgb);
  const nearest = (c: number) => {
    const [r, g, b] = rgb(c);
    let best = 0, distance = Infinity;
    palette.forEach((p, k) => { const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2; if (d < distance) { distance = d; best = k; } });
    return best;
  };
  return { palette, indexOf: new Map(colours.map((c) => [c, nearest(c)])) };
}

/** Bytes appended one at a time or a few at a time, grown as needed. */
class Bytes {
  private data = Buffer.alloc(1 << 16);
  length = 0;
  push(...values: number[]) {
    if (this.length + values.length > this.data.length) { const grown = Buffer.alloc(Math.max(this.data.length * 2, this.length + values.length)); this.data.copy(grown); this.data = grown; }
    for (const v of values) this.data[this.length++] = v;
  }
  word(v: number) { this.push(v & 255, (v >> 8) & 255); }
  text(s: string) { for (let k = 0; k < s.length; k++) this.push(s.charCodeAt(k)); }
  bytes() { return Buffer.from(this.data.subarray(0, this.length)); }
}

/**
 * GIF's variable-length LZW over palette indices, written as the data sub-blocks of one image. Codes start one
 * bit wider than `minCode`, grow as the table does, and the table is cleared when its 4096 entries are used.
 * The table is a hash of (code so far, next index) to the code for both.
 */
function lzw(out: Bytes, index: Uint8Array, minCode: number): void {
  const clear = 1 << minCode, end = clear + 1;
  const SLOTS = 8192, keys = new Int32Array(SLOTS).fill(-1), codes = new Uint16Array(SLOTS);
  const block = new Uint8Array(255);
  let size = minCode + 1, next = end + 1, held = 0, bits = 0, filled = 0;
  const emit = (code: number) => {
    held |= code << bits; bits += size;
    while (bits >= 8) {
      block[filled++] = held & 255; held >>>= 8; bits -= 8;
      if (filled === 255) { out.push(255, ...block); filled = 0; }
    }
  };
  out.push(minCode);
  emit(clear);
  let prefix = index[0]!;
  for (let p = 1; p < index.length; p++) {
    const c = index[p]!, key = (prefix << 8) | c;
    let slot = (key * 0x9e3779b1) >>> 19; // 13 bits
    while (keys[slot] !== -1 && keys[slot] !== key) slot = (slot + 1) & (SLOTS - 1);
    if (keys[slot] === key) { prefix = codes[slot]!; continue; }
    emit(prefix);
    prefix = c;
    if (next === 4096) { emit(clear); keys.fill(-1); size = minCode + 1; next = end + 1; continue; }
    if (next === 1 << size) size++; // the code about to be given no longer fits
    keys[slot] = key; codes[slot] = next++;
  }
  emit(prefix);
  emit(end);
  if (bits > 0) { block[filled++] = held & 255; }
  if (filled > 0) out.push(filled, ...block.subarray(0, filled));
  out.push(0);
}

/**
 * PNG frames of one size to an animated GIF that loops for ever, each frame up for `delayMs` (a GIF counts in
 * hundredths of a second, so the nearest whole number of them, and never fewer than two, which viewers slow down).
 * One palette for the whole file. After the first frame only the box around what changed is written, with the
 * pixels inside it that did not change left transparent over the frame before; a frame identical to the one
 * before is not written, the one before is held. Nothing in the file depends on when or where it was made.
 */
export function encodeGif(frames: Buffer[], { delayMs }: { delayMs: number }): Buffer {
  if (!frames.length) throw new Error("encodeGif: no frames");
  const delay = Math.max(2, Math.round(delayMs / 10));
  const counts = new Map<number, number>();
  let size: { width: number; height: number } | undefined, before: Uint32Array | undefined;
  for (const png of frames) {
    const { width, height, colours } = pixels(png);
    size ??= { width, height };
    if (width !== size.width || height !== size.height) throw new Error(`encodeGif: frames differ in size (${size.width}x${size.height} and ${width}x${height})`);
    for (let p = 0; p < colours.length; p++) if (!before || before[p] !== colours[p]) counts.set(colours[p]!, (counts.get(colours[p]!) ?? 0) + 1);
    before = colours;
  }
  const { width, height } = size!;
  const { palette, indexOf } = paletteOf(counts);
  const same = palette.length; // one more entry than the picture uses: "as the frame before"
  const depth = Math.max(1, Math.ceil(Math.log2(palette.length + 1))); // the table holds 2^depth colours
  const out = new Bytes();
  out.text("GIF89a");
  out.word(width); out.word(height);
  out.push(0x80 | 0x70 | (depth - 1), 0, 0); // a global colour table of 2^depth entries, 8 bits a channel
  for (let k = 0; k < 1 << depth; k++) out.push(...(palette[k] ?? [0, 0, 0]));
  out.push(0x21, 0xff, 11); out.text("NETSCAPE2.0"); out.push(3, 1, 0, 0, 0); // loop for ever

  const shown = new Uint8Array(width * height);
  let pending: { index: Uint8Array; x: number; y: number; w: number; h: number; hundredths: number; first: boolean } | undefined;
  const write = () => {
    if (!pending) return;
    out.push(0x21, 0xf9, 4, (1 << 2) | (pending.first ? 0 : 1)); // leave the frame in place; later frames have a transparent index
    out.word(pending.hundredths); out.push(pending.first ? 0 : same, 0);
    out.push(0x2c); out.word(pending.x); out.word(pending.y); out.word(pending.w); out.word(pending.h); out.push(0);
    lzw(out, pending.index, Math.max(2, depth));
  };
  for (const png of frames) {
    const { colours } = pixels(png);
    const index = new Uint8Array(width * height);
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let p = 0; p < colours.length; p++) {
      const k = indexOf.get(colours[p]!)!;
      if (pending && shown[p] === k) { index[p] = same; continue; }
      index[p] = k; shown[p] = k;
      const x = p % width, y = (p - x) / width;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (pending && x1 < 0) { pending.hundredths += delay; continue; }
    write();
    const w = x1 - x0 + 1, h = y1 - y0 + 1, box = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) box.set(index.subarray((y0 + y) * width + x0, (y0 + y) * width + x0 + w), y * w);
    pending = { index: box, x: x0, y: y0, w, h, hundredths: delay, first: !pending };
  }
  write();
  out.push(0x3b);
  return out.bytes();
}

export interface GifOptions extends RasterOptions {
  /** Frames a second; a GIF times frames in hundredths of a second, so this is rounded to 100/n. Default 10. */
  fps?: number;
  /** The loop's length in milliseconds. Default: the picture's own (fitLoop). */
  durationMs?: number;
}

/** One loop of an animated picture as GIF bytes: the frames of `fitLoop`'s picture, evenly spaced over its loop. */
export function renderGif(svg: string, { fps = 10, durationMs, ...raster }: GifOptions = {}): Buffer {
  const loop = fitLoop(svg, durationMs !== undefined ? { durationMs } : {});
  const delayMs = Math.max(2, Math.round(100 / fps)) * 10;
  const count = Math.max(1, Math.round(loop.durationMs / delayMs));
  return encodeGif(Array.from({ length: count }, (_, i) => rasterize(freezeFrame(loop.svg, (i * loop.durationMs) / count), raster)), { delayMs });
}
