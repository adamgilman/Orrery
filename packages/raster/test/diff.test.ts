import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeLayoutEngine, render, validate } from "@orrery/core";
import { decodePng, diffFrames, flowRegions, inspect, isolateFlow, renderFrames, type Bitmap } from "../src/index.js";

const fixture = async (name: string) => {
  const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid", `${name}.json`), "utf8")));
  if (!r.ok) throw new Error(name);
  return render(r.diagram, new FakeLayoutEngine());
};
const bitmap = (w: number, h: number, paint: (x: number, y: number) => number): Bitmap => {
  const data = Buffer.alloc(w * h * 4, 255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = paint(x, y); data[(y * w + x) * 4] = v; data[(y * w + x) * 4 + 1] = v; data[(y * w + x) * 4 + 2] = v; }
  return { width: w, height: h, data };
};

describe("diffFrames", () => {
  it("reports zero change and an empty box for identical frames", () => {
    const a = bitmap(10, 10, (x) => (x < 5 ? 0 : 255));
    const d = diffFrames(a, a);
    expect(d.changed).toBe(0);
    expect(d.bbox).toBeNull();
    expect(d.image.width).toBe(10);
  });
  it("counts changed pixels and boxes them", () => {
    const a = bitmap(10, 10, (x, y) => (x === 2 && y === 3 ? 0 : 255));
    const b = bitmap(10, 10, (x, y) => (x === 7 && y === 3 ? 0 : 255));
    const d = diffFrames(a, b);
    expect(d.changed).toBe(2);
    expect(d.bbox).toEqual({ x: 2, y: 3, width: 6, height: 1 });
  });
  it("can count how many changed pixels fall outside given regions", () => {
    const a = bitmap(10, 10, (x, y) => (x === 2 && y === 3 ? 0 : 255));
    const b = bitmap(10, 10, (x, y) => (x === 7 && y === 3 ? 0 : 255));
    const d = diffFrames(a, b, { allowed: [{ x: 0, y: 0, width: 5, height: 10 }] });
    expect(d.outside).toBe(1);
  });
});

describe("frame subtraction on real renders", () => {
  it("consecutive frames differ only inside flow regions: nothing static ever changes", async () => {
    const svg = await fixture("three-tier");
    const regions = Object.values(flowRegions(svg, 1));
    const frames = renderFrames(svg, { fps: 10, durationMs: 800 }).map((f) => decodePng(f.png));
    for (let i = 1; i < frames.length; i++) {
      const d = diffFrames(frames[i - 1]!, frames[i]!, { allowed: regions });
      expect(d.changed, `frame ${i} changed`).toBeGreaterThan(0);
      expect(d.outside, `frame ${i} outside`).toBe(0);
    }
  });
  it("a moving edge changes a steady number of pixels per step (uniform motion)", async () => {
    const svg = await fixture("fan-out");
    const alone = isolateFlow(svg, "s3->cache");
    const frames = renderFrames(alone, { fps: 20, durationMs: 1000 }).map((f) => decodePng(f.png));
    const counts = frames.slice(1).map((f, i) => diffFrames(frames[i]!, f).changed);
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const cv = Math.sqrt(counts.reduce((a, c) => a + (c - mean) ** 2, 0) / counts.length) / mean;
    expect(mean).toBeGreaterThan(0);
    expect(cv, `counts ${counts.join(",")}`).toBeLessThan(0.25);
  });
  it("inspect reports per-step change and flags change outside flow regions", async () => {
    const report = inspect(await fixture("fan-out"), { fps: 10, durationMs: 500 });
    expect(report.steps).toHaveLength(4);
    for (const s of report.steps) { expect(s.changed).toBeGreaterThan(0); expect(s.outside).toBe(0); }
    expect(report.ok).toBe(true);
  });
});
