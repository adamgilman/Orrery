import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, validate, type RenderOptions } from "@orrery-diagrams/core";
import { FakeLayoutEngine } from "@orrery-diagrams/core/testing";
import { decodePng, encodeGif, encodePng, fitLoop, freezeFrame, rasterize, renderGif, renderPng, type Bitmap } from "../src/index.js";
import { decodeGif } from "./gifDecode.js";

const draw = async (model: unknown, options: RenderOptions = {}) => {
  const r = validate(model);
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return render(r.model, new FakeLayoutEngine(), options);
};
const fixture = (name: string, options: RenderOptions = {}) => draw(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid", `${name}.json`), "utf8")), options);
/** A chain of components whose connections carry these loads: a flow's period is 0.5 + (1 - load) * 2.5 seconds. */
const chain = (...loads: number[]) => draw({
  components: [{ id: "c0" }, ...loads.map((_, i) => ({ id: `c${i + 1}` }))],
  connections: loads.map((load, i) => ({ from: `c${i}`, to: `c${i + 1}`, load })),
});
const durations = (svg: string) => svg.split('<path class="flow"').slice(1).flatMap((path) => { const m = path.slice(0, path.indexOf("/>")).match(/animation-duration:([\d.]+)s/); return m ? [Number(m[1])] : []; });
const frame = (svg: string, tMs: number) => rasterize(freezeFrame(svg, tMs));
/** Mean absolute difference per colour channel between two pictures of one size. */
const meanError = (a: Buffer, b: Buffer) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!); return sum / a.length; };
const solid = (width: number, height: number, rgb: [number, number, number]): Bitmap => {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...rgb, 255], i * 4);
  return { width, height, data };
};
const paint = (bm: Bitmap, x: number, y: number, rgb: [number, number, number]) => { bm.data.set([...rgb, 255], (y * bm.width + x) * 4); return bm; };

describe("the loop of an animated picture (R19)", () => {
  it("is nothing for a picture that does not move", async () => {
    const svg = await draw({ components: [{ id: "a" }, { id: "b" }] });
    expect(fitLoop(svg)).toEqual({ durationMs: 0, stretch: 0, svg });
  });
  it("is the shortest time in which every flow completes whole cycles, the file untouched when one exists", async () => {
    const svg = await chain(0.8, 0.6); // 1 s and 1.5 s
    expect(durations(svg)).toEqual([1, 1.5]);
    expect(fitLoop(svg)).toEqual({ durationMs: 3000, stretch: 0, svg });
  });
  it("fits flows with no short common period to one, changing each period by a few percent and never their order", async () => {
    const svg = await chain(0.8, 0.6, 0.48, 0.2); // 1 s, 1.5 s, 1.8 s, 2.5 s: together again only after 45 s
    const before = durations(svg);
    expect(before).toEqual([1, 1.5, 1.8, 2.5]);
    const loop = fitLoop(svg);
    expect(loop.durationMs).toBeLessThanOrEqual(8000);
    expect(loop.stretch).toBeGreaterThan(0);
    expect(loop.stretch).toBeLessThanOrEqual(0.05);
    const after = durations(loop.svg);
    after.forEach((d, i) => {
      const cycles = loop.durationMs / 1000 / d;
      expect(Math.abs(cycles - Math.round(cycles)), `flow ${i} runs ${cycles} cycles`).toBeLessThan(1e-4);
      expect(Math.abs(d / before[i]! - 1)).toBeLessThanOrEqual(loop.stretch + 1e-6);
    });
    expect([...after].sort((a, b) => a - b)).toEqual(after);
    // the proof is in pixels: the frame at the end of the loop is the first frame, and the middle is not
    expect(frame(loop.svg, loop.durationMs).equals(frame(loop.svg, 0))).toBe(true);
    expect(frame(loop.svg, loop.durationMs / 2).equals(frame(loop.svg, 0))).toBe(false);
  });
  it("is a playing view's whole cycle, with flows and the pulse fitted inside it", async () => {
    const svg = await fixture("alternatives", { play: { scenario: "orders-failover", seconds: 2 } });
    const total = Number(svg.match(/animation:orrery-play-[\w-]+ ([\d.]+)s step-end infinite/)![1]) * 1000;
    const loop = fitLoop(svg);
    expect(loop.durationMs).toBe(total);
    expect(loop.svg).toContain("orrery-pulse");
    expect(frame(loop.svg, loop.durationMs).equals(frame(loop.svg, 0))).toBe(true);
    expect(frame(loop.svg, loop.durationMs / 2).equals(frame(loop.svg, 0))).toBe(false);
  });
  it("is the length asked for when one is given", async () => {
    const svg = await chain(0.8, 0.6);
    const loop = fitLoop(svg, { durationMs: 2000 });
    expect(loop.durationMs).toBe(2000);
    expect(durations(loop.svg)).toEqual([1, 2]);
    expect(frame(loop.svg, 2000).equals(frame(loop.svg, 0))).toBe(true);
  });
});

describe("encodeGif (R19)", () => {
  it("keeps the colours of a picture with few of them exactly, and writes only what changed after the first frame", () => {
    const red: [number, number, number] = [220, 38, 38];
    const a = paint(solid(8, 6, [255, 255, 255]), 1, 1, red);
    const b = paint(paint(solid(8, 6, [255, 255, 255]), 1, 1, red), 5, 4, [37, 99, 235]);
    const gif = decodeGif(encodeGif([a, b].map(encodePng), { delayMs: 100 }));
    expect([gif.width, gif.height, gif.loops]).toEqual([8, 6, 0]); // loops forever
    expect(gif.frames.map((f) => f.delayCs)).toEqual([10, 10]);
    expect(gif.frames[0]!.rgba.equals(a.data)).toBe(true);
    expect(gif.frames[1]!.rgba.equals(b.data)).toBe(true);
    expect(gif.frames[0]!.rect).toEqual([0, 0, 8, 6]);
    expect(gif.frames[1]!.rect).toEqual([5, 4, 1, 1]); // the one pixel that changed
  });
  it("writes the box around what changed, and leaves what did not change inside it transparent", () => {
    const a = solid(8, 6, [255, 255, 255]);
    const b = paint(paint(solid(8, 6, [255, 255, 255]), 2, 1, [0, 0, 0]), 5, 4, [0, 0, 0]);
    const gif = decodeGif(encodeGif([a, b].map(encodePng), { delayMs: 100 }));
    expect(gif.frames[1]!.rect).toEqual([2, 1, 4, 4]);
    expect(gif.frames[1]!.transparentPixels).toBe(4 * 4 - 2);
    expect(gif.frames[1]!.rgba.equals(b.data)).toBe(true);
  });
  it("survives pictures that fill and reset the code table many times, with any number of colours", () => {
    // noise is the worst case for the compressor: every code is new, so the 4096-entry table fills and is cleared over and over
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (const colours of [2, 3, 17, 200]) {
      const shades = Array.from({ length: colours }, (_, i) => [i, 255 - i, (i * 7) % 256] as [number, number, number]);
      const noise = () => { const bm = solid(97, 61, [0, 0, 0]); for (let y = 0; y < 61; y++) for (let x = 0; x < 97; x++) paint(bm, x, y, shades[Math.floor(random() * colours)]!); return bm; };
      const frames = [noise(), noise(), noise()];
      const gif = decodeGif(encodeGif(frames.map(encodePng), { delayMs: 100 }));
      frames.forEach((f, i) => expect(gif.frames[i]!.rgba.equals(f.data), `${colours} colours, frame ${i}`).toBe(true));
    }
  });
  it("brings a picture of many colours down to 255, keeping the ones most of it is made of exactly", () => {
    const bm = solid(64, 64, [255, 255, 255]);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) paint(bm, x, y, [x * 4, y * 8, 128]); // 2048 colours of a gradient
    for (let y = 40; y < 60; y++) for (let x = 10; x < 50; x++) paint(bm, x, y, [37, 99, 235]);
    const gif = decodeGif(encodeGif([encodePng(bm)], { delayMs: 100 }));
    expect(gif.colours).toBe(256);
    const out = gif.frames[0]!.rgba;
    const at = (x: number, y: number) => [...out.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 3)];
    expect(at(60, 62)).toEqual([255, 255, 255]);
    expect(at(20, 50)).toEqual([37, 99, 235]);
    expect(meanError(out, bm.data)).toBeLessThan(4);
  });
  it("holds a frame that repeats instead of writing it again", () => {
    const a = solid(4, 4, [255, 255, 255]), b = paint(solid(4, 4, [255, 255, 255]), 2, 2, [0, 0, 0]);
    const gif = decodeGif(encodeGif([a, a, a, b].map(encodePng), { delayMs: 80 }));
    expect(gif.frames.map((f) => f.delayCs)).toEqual([24, 8]);
  });
  it("refuses frames of different sizes", () => {
    expect(() => encodeGif([solid(4, 4, [0, 0, 0]), solid(5, 4, [0, 0, 0])].map(encodePng), { delayMs: 100 })).toThrow(/size/);
  });
});

describe("renderGif (R19)", () => {
  it("is one loop of the picture at the frame rate asked for, each frame the SVG frozen at its moment", async () => {
    const svg = await chain(0.8, 0.6);
    const gif = decodeGif(renderGif(svg, { fps: 10 }));
    const first = decodePng(frame(svg, 0));
    expect([gif.width, gif.height]).toEqual([first.width, first.height]);
    expect(gif.loops).toBe(0);
    expect(gif.frames).toHaveLength(30); // 3 s at 10 frames a second
    expect(gif.frames.every((f) => f.delayCs === 10)).toBe(true);
    for (const k of [0, 7, 29]) {
      const exact = decodePng(frame(svg, k * 100)).data;
      expect(meanError(gif.frames[k]!.rgba, exact), `frame ${k}`).toBeLessThan(1);
      // and it is that moment, not another: the dashes of a different moment are further away
      expect(meanError(gif.frames[k]!.rgba, exact)).toBeLessThan(meanError(gif.frames[k]!.rgba, decodePng(frame(svg, k * 100 + 400)).data));
    }
  });
  it("draws at the scale asked for and rounds the frame rate to what a GIF can time", async () => {
    const svg = await chain(0.8);
    const gif = decodeGif(renderGif(svg, { scale: 2, fps: 12 }));
    const first = decodePng(rasterize(svg, { scale: 2 }));
    expect([gif.width, gif.height]).toEqual([first.width, first.height]);
    expect(gif.frames.every((f) => f.delayCs === 8)).toBe(true); // 12 a second is 8.33 hundredths; a GIF counts whole ones
    expect(gif.frames.reduce((s, f) => s + f.delayCs, 0)).toBe(104); // 13 frames: the nearest whole number of them to the 1 s loop
  });
  it("is a single frame for a picture that does not move", async () => {
    const svg = await draw({ components: [{ id: "a" }, { id: "b" }] });
    expect(decodeGif(renderGif(svg)).frames).toHaveLength(1);
  });
  it("shows a playing scenario's steps in turn", async () => {
    const svg = await fixture("alternatives", { play: { scenario: "orders-failover", seconds: 1 } });
    const loop = fitLoop(svg);
    const gif = decodeGif(renderGif(svg, { fps: 5 }));
    expect(gif.frames.reduce((s, f) => s + f.delayCs, 0) * 10).toBe(loop.durationMs);
    const at = (tMs: number) => gif.frames[Math.round(tMs / 200)]!.rgba;
    // the base picture and the first step differ by far more than moving dashes do
    expect(meanError(at(0), at(1000))).toBeGreaterThan(5 * meanError(at(0), at(400)));
    expect(meanError(at(1000), decodePng(frame(loop.svg, 1000)).data)).toBeLessThan(1);
  });
  it("is deterministic: same picture, same bytes", async () => {
    const svg = await fixture("fan-out");
    expect(renderGif(svg, { fps: 5 }).equals(renderGif(svg, { fps: 5 }))).toBe(true);
  });
});

describe("renderPng (R19)", () => {
  it("is the picture at rest: the first step of a playing view, as the frame at t = 0", async () => {
    const svg = await fixture("alternatives", { play: { scenario: "orders-failover", seconds: 1 } });
    expect(renderPng(svg).equals(frame(svg, 0))).toBe(true);
    expect(renderPng(svg).equals(renderPng(svg))).toBe(true);
    const twice = decodePng(renderPng(svg, { scale: 2 })), once = decodePng(renderPng(svg));
    expect(twice.width).toBeGreaterThanOrEqual(once.width * 2 - 1);
  });
});
