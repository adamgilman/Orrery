import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeLayoutEngine, render, validate } from "@orrery-diagrams/core";
import { cropPng, decodePng, inspect, rasterize } from "../src/index.js";

const fixture = async (name: string) => {
  const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid", `${name}.json`), "utf8")));
  if (!r.ok) throw new Error(name);
  return render(r.model, new FakeLayoutEngine());
};

describe("inspect", () => {
  it("reports well-formed XML, size, and per-edge animation health", async () => {
    const report = inspect(await fixture("fan-out"));
    expect(report.xml.ok).toBe(true);
    expect(report.size.width).toBeGreaterThan(0);
    expect(report.connections).toHaveLength(6);
    const byKey = Object.fromEntries(report.connections.map((e) => [e.key, e]));
    expect(byKey["s1->cache"]).toMatchObject({ load: 1, periodic: true, moving: true });
    expect(byKey["s2->cache"]).toMatchObject({ load: 0, periodic: true, moving: false });
    expect(report.ok).toBe(true);
  });
  it("measures a zoomed export, whose viewBox does not start at the origin (an outside review)", async () => {
    const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid", "fan-out.json"), "utf8")));
    if (!r.ok) throw new Error("fan-out");
    const svg = await render(r.model, new FakeLayoutEngine(), { zoom: "cache" });
    const [x, y, w, h] = svg.match(/viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/)!.slice(1).map(Number) as [number, number, number, number];
    expect(x + y).toBeGreaterThan(0);
    const report = inspect(svg);
    expect(report.size).toEqual({ width: w, height: h });
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
  });
  it("rasterises a zoomed export as the exact pixel crop of the whole drawing", async () => {
    const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid", "fan-out.json"), "utf8")));
    if (!r.ok) throw new Error("fan-out");
    const whole = await render(r.model, new FakeLayoutEngine());
    const zoomed = await render(r.model, new FakeLayoutEngine(), { zoom: "cache" });
    const [x, y, w, h] = zoomed.match(/viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/)!.slice(1).map(Number) as [number, number, number, number];
    const scale = 2;
    const got = decodePng(rasterize(zoomed, { scale }));
    expect([got.width, got.height]).toEqual([Math.round(w * scale), Math.round(h * scale)]);
    // the crop may run past the drawing's edge (air around the zoom target); compare the rows both pictures have
    const all = decodePng(rasterize(whole, { scale }));
    const rows = Math.min(got.height, all.height - Math.round(y * scale));
    const want = decodePng(cropPng(all, { x: Math.round(x * scale), y: Math.round(y * scale), width: got.width, height: rows }));
    expect(rows).toBeGreaterThan(got.height / 2);
    expect(got.data.subarray(0, rows * got.width * 4).equals(want.data)).toBe(true);
  });
  it("fails on malformed XML", () => {
    const report = inspect(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g></svg>`);
    expect(report.xml.ok).toBe(false);
    expect(report.ok).toBe(false);
  });
  it("fails when a flow's dash pattern does not match the period the freeze assumes", async () => {
    const svg = (await fixture("fan-out")).replaceAll("stroke-dasharray:6 10", "stroke-dasharray:6 6");
    const report = inspect(svg);
    expect(report.ok).toBe(false);
    expect(report.connections.some((e) => e.load > 0 && !e.periodic)).toBe(true);
  });
});
