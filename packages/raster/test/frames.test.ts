import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeLayoutEngine, flowDuration, render, validate } from "@orrery/core";
import { contactSheet, decodePng, flowRegions, isolateFlow, rasterize, regionEquals, renderFrames } from "../src/index.js";

const fixture = async (name: string) => {
  const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid", `${name}.json`), "utf8")));
  if (!r.ok) throw new Error(name);
  return render(r.diagram, new FakeLayoutEngine());
};

describe("rasterize", () => {
  it("produces a PNG sized to the viewBox times scale", async () => {
    const svg = await fixture("minimal");
    const png = decodePng(rasterize(svg, { scale: 2 }));
    const [, w, h] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!;
    expect(png.width).toBe(Math.round(Number(w) * 2));
    expect(png.height).toBe(Math.round(Number(h) * 2));
  });
  it("is deterministic", async () => {
    const svg = await fixture("three-tier");
    expect(rasterize(svg).equals(rasterize(svg))).toBe(true);
  });
});

describe("flowRegions", () => {
  it("finds one padded bounding box per flow path, keyed by edge", async () => {
    const svg = await fixture("fan-out");
    const regions = flowRegions(svg, 1);
    expect(Object.keys(regions)).toContain("s1->cache");
    expect(Object.keys(regions)).toHaveLength(6);
    const r = regions["lb->s1"]!;
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
    expect(r.load).toBe(0.3);
  });
});

describe("animation via frames with known timing", () => {
  it("each edge's region repeats exactly after its own period and differs at half period", async () => {
    const svg = await fixture("fan-out");
    const regions = flowRegions(svg, 1);
    for (const [key, r] of Object.entries(regions)) {
      if (r.load === 0) continue;
      const d = flowDuration(r.load) * 1000;
      // Other edges may share the bounding box with a different period, so judge each flow alone.
      const [f0, fHalf, fFull] = renderFrames(isolateFlow(svg, key), { times: [0, d / 2, d] }).map((f) => decodePng(f.png));
      expect(regionEquals(f0!, fFull!, r), `${key} periodic`).toBe(true);
      expect(regionEquals(f0!, fHalf!, r), `${key} moving`).toBe(false);
    }
  });
  it("a zero-load edge never changes", async () => {
    const svg = await fixture("fan-out");
    const r = flowRegions(svg, 1)["s2->cache"]!;
    const [a, b] = renderFrames(isolateFlow(svg, "s2->cache"), { times: [0, 137] }).map((f) => decodePng(f.png));
    expect(regionEquals(a!, b!, r)).toBe(true);
  });
  it("renderFrames with fps and duration yields evenly spaced frames", async () => {
    const svg = await fixture("minimal");
    const frames = renderFrames(svg, { fps: 10, durationMs: 500 });
    expect(frames.map((f) => f.tMs)).toEqual([0, 100, 200, 300, 400]);
  });
});

describe("isolateFlow", () => {
  it("keeps only the named flow path and leaves nodes and base edges intact", async () => {
    const svg = await fixture("fan-out");
    const one = isolateFlow(svg, "lb->s2");
    expect(one.match(/<path class="flow"/g)).toHaveLength(1);
    expect(one).toContain('data-flow="lb->s2"');
    expect(one.match(/<path class="edge[ "]/g)).toHaveLength(6);
    expect(one.match(/<g class="node"/g)).toHaveLength(5);
  });
});

describe("contactSheet", () => {
  it("tiles frames into a grid with a gutter", async () => {
    const svg = await fixture("minimal");
    const frames = renderFrames(svg, { fps: 5, durationMs: 1000, scale: 1 }).map((f) => f.png);
    const one = decodePng(frames[0]!);
    const sheet = decodePng(contactSheet(frames, { columns: 3, gutter: 4 }));
    expect(sheet.width).toBe(one.width * 3 + 4 * 4);
    expect(sheet.height).toBe(one.height * 2 + 4 * 3);
  });
});
