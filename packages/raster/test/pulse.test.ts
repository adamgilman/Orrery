import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, validate } from "@orrery-diagrams/core";
import { FakeLayoutEngine } from "@orrery-diagrams/core/testing";
import { PULSE_PERIOD } from "@orrery-diagrams/core/internal";
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

describe("a line in a state (#60, R22)", () => {
  const model = () => {
    const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid/connection-states.json"), "utf8")));
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.model;
  };
  /** The colour at the middle of a line's first segment, and at the base of its arrowhead. */
  const colours = (svg: string, key: string, t = 0) => {
    const d = svg.match(new RegExp(`data-edge="${key}"[^>]* d="([^"]+)"`))![1]!;
    const pts = [...d.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((p) => ({ x: Number(p[1]), y: Number(p[2]) }));
    const bm = decodePng(rasterize(freezeFrame(svg, t)));
    const at = (x: number, y: number) => { const i = (Math.round(y) * bm.width + Math.round(x)) * 4; return [bm.data[i]!, bm.data[i + 1]!, bm.data[i + 2]!]; };
    const a = pts[pts.length - 2]!, b = pts[pts.length - 1]!, len = Math.hypot(b.x - a.x, b.y - a.y);
    return { line: at((pts[0]!.x + pts[1]!.x) / 2, (pts[0]!.y + pts[1]!.y) / 2), head: at(b.x - ((b.x - a.x) / len) * 5, b.y - ((b.y - a.y) / len) * 5) };
  };
  const reddish = ([r, g, b]: number[]) => r! > 180 && g! < 110 && b! < 110;
  const greyish = ([r, g, b]: number[]) => Math.abs(r! - g!) < 30 && Math.abs(g! - b!) < 40;

  it("a failed line and its arrowhead are the alert colour; its neighbours and the line it was are not", async () => {
    const plain = await render(model(), new FakeLayoutEngine(), { view: "all", set: { on: ["api-to-cache"] } });
    const before = colours(plain, "api-to-db");
    expect(greyish(before.head), `plain arrowhead ${before.head}`).toBe(true);
    expect(reddish(before.line)).toBe(false);
    const svg = await render(model(), new FakeLayoutEngine(), { view: "all", scenario: "cert-expires", step: 1 });
    const failed = colours(svg, "api-to-db");
    expect(reddish(failed.line), `line ${failed.line}`).toBe(true);
    expect(reddish(failed.head), `arrowhead ${failed.head}`).toBe(true);
    expect(reddish(colours(svg, "web-to-api").head)).toBe(false);
  });
  it("it shows no flow, pulses with the alert look, and a frame check passes: nothing else moves", async () => {
    const svg = await render(model(), new FakeLayoutEngine(), { view: "all", scenario: "cert-expires", step: 1 });
    const report = inspect(svg, { fps: 5, durationMs: 600 });
    expect(report.problems).toEqual([]);
    const c = report.connections.find((x) => x.key === "api-to-db")!;
    expect(c).toMatchObject({ load: 0, moving: false });
    expect(report.connections.find((x) => x.key === "web-to-api")!.moving).toBe(true);
    const dim = colours(svg, "api-to-db", (PULSE_PERIOD * 1000) / 2).line, full = colours(svg, "api-to-db", 0).line;
    expect(dim[1]!, "the stroke fades at half the pulse").toBeGreaterThan(full[1]! + 40);
  });
  it("a playing render draws the failed line in its step and takes it back in the next", async () => {
    const svg = await render(model(), new FakeLayoutEngine(), { view: "playing" });
    const report = inspect(svg, { fps: 5, durationMs: 600 });
    expect(report.xml.ok).toBe(true);
    expect((svg.match(/class="edge edge-sync st-failed"/g) ?? []).length, "one layer of three has the failed line").toBe(1);
  });
});
