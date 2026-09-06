import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeLayoutEngine, PULSE_PERIOD, render, validate } from "@orrery-diagrams/core";
import { decodePng, diffFrames, freezeFrame, inspect, pulseRegions, rasterize } from "../src/index.js";

const failing = async () => {
  const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid/alternatives.json"), "utf8")));
  if (!r.ok) throw new Error();
  return render(r.model, new FakeLayoutEngine(), { scenario: "orders-failover", step: 1 });
};

describe("failure pulse in frames", () => {
  it("freezeFrame replaces the pulse with a static stroke-opacity that varies with t", async () => {
    const svg = await failing();
    const a = freezeFrame(svg, 0), b = freezeFrame(svg, (PULSE_PERIOD * 1000) / 2);
    expect(a).not.toContain("animation:orrery-pulse");
    expect(a).toMatch(/\.st-failed \.node-box\{[^}]*stroke-opacity:1[;}]/);
    expect(b).toMatch(/\.st-failed \.node-box\{[^}]*stroke-opacity:0\.4[;}]/);
  });
  it("pulseRegions finds the pulsing boxes", async () => {
    const svg = await failing();
    const regions = pulseRegions(svg, 1);
    expect(Object.keys(regions)).toEqual(["orders"]);
    expect(regions.orders!.width).toBeGreaterThan(0);
  });
  it("inspect treats pulsing nodes as allowed motion and passes", async () => {
    const svg = await failing();
    const report = inspect(svg, { fps: 5, durationMs: 600 });
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    const [f0, f1] = [0, 300].map((t) => decodePng(rasterize(freezeFrame(svg, t))));
    const d = diffFrames(f0!, f1!, { allowed: Object.values(pulseRegions(svg, 1)) });
    expect(d.changed).toBeGreaterThan(0);
  });
});
