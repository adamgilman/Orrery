import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeLayoutEngine, render, validate } from "@orrery/core";
import { inspect } from "../src/index.js";

const fixture = async (name: string) => {
  const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid", `${name}.json`), "utf8")));
  if (!r.ok) throw new Error(name);
  return render(r.diagram, new FakeLayoutEngine());
};

describe("inspect", () => {
  it("reports well-formed XML, size, and per-edge animation health", async () => {
    const report = inspect(await fixture("fan-out"));
    expect(report.xml.ok).toBe(true);
    expect(report.size.width).toBeGreaterThan(0);
    expect(report.edges).toHaveLength(6);
    const byKey = Object.fromEntries(report.edges.map((e) => [e.key, e]));
    expect(byKey["s1->cache"]).toMatchObject({ load: 1, periodic: true, moving: true });
    expect(byKey["s2->cache"]).toMatchObject({ load: 0, periodic: true, moving: false });
    expect(report.ok).toBe(true);
  });
  it("fails on malformed XML", () => {
    const report = inspect(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g></svg>`);
    expect(report.xml.ok).toBe(false);
    expect(report.ok).toBe(false);
  });
  it("fails when a flow's timing does not match its declared duration", async () => {
    // Sabotage: declare 1s but the frozen offset will be computed from it, so timing still matches.
    // Real failure mode: a flow whose dash pattern differs from FLOW_DASH, making the period wrong.
    const svg = (await fixture("fan-out")).replace("stroke-dasharray:6 10", "stroke-dasharray:6 6");
    const report = inspect(svg);
    expect(report.ok).toBe(false);
    expect(report.edges.some((e) => e.load > 0 && !e.periodic)).toBe(true);
  });
});
