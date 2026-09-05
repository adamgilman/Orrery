import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeLayoutEngine, render, validate } from "@orrery/core";
import { inspect } from "../src/index.js";

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
