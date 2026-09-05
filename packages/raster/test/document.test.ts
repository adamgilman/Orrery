import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeLayoutEngine, render, renderDocument, validate } from "@orrery/core";
import { activeView, flowRegions, inspect } from "../src/index.js";

const grouped = async () => {
  const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid/grouped.json"), "utf8")));
  if (!r.ok) throw new Error();
  return renderDocument(r.model, new FakeLayoutEngine(), { runtime: "var x = 1; /* ]]> */" });
};

describe("multi-view documents in the frame tooling", () => {
  it("activeView keeps only the visible layer and drops scripts", async () => {
    const svg = await grouped();
    const one = activeView(svg);
    expect((one.match(/<g class="view"/g) ?? []).length).toBe(1);
    expect(one).toContain('data-view="overview"');
    expect(one).not.toMatch(/<script/);
    expect(one.trimEnd().endsWith("</svg>")).toBe(true);
  });
  it("flowRegions and inspect consider only the visible view", async () => {
    const svg = await grouped();
    expect(Object.keys(flowRegions(svg))).toEqual(["web->api", "api->db", "api-reads", "db->replica"]);
    const report = inspect(svg, { fps: 5, durationMs: 400 });
    expect(report.ok, report.problems.join("; ")).toBe(true);
    expect(report.connections.map((e) => e.key)).toEqual(["web->api", "api->db", "api-reads", "db->replica"]);
  });
});

describe("playing views in the frame tooling", () => {
  it("activeView keeps only the base step so the checks see a still model", async () => {
    const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid/alternatives.json"), "utf8")));
    if (!r.ok) throw new Error();
    const svg = await renderDocument(r.model, new FakeLayoutEngine(), { runtime: "", view: "failover-loop" });
    const one = activeView(svg);
    expect((one.match(/<g class="step"/g) ?? []).length).toBe(1);
    expect(one).toContain('data-step="0"');
    expect(inspect(svg, { fps: 5, durationMs: 400 }).ok).toBe(true);
  });
});

describe("tours in the frame tooling", () => {
  it("activeView keeps the first state of a one-drawing tour and shows closed groups at rest: summaries, no hidden detail", async () => {
    const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid/drill-down.json"), "utf8")));
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const svg = await render(r.model, new FakeLayoutEngine(), { tour: true });
    const one = activeView(svg);
    expect((one.match(/<g class="state"/g) ?? []).length).toBe(1);
    expect(one).not.toMatch(/<[^>]*data-lod="detail"/); // no hidden elements remain (the stylesheet still names the attribute)
    expect(one).not.toContain('data-node="ledger"');
    expect(one).toMatch(/<path class="flow" data-flow="checkout->pay-api" data-load="0.5" d="/); // the summary stands in for the cut connection
    const report = inspect(svg, { fps: 5, durationMs: 400 });
    expect(report.problems).toEqual([]);
    expect(report.connections.map((c) => c.key)).toEqual(["web->checkout", "web->catalog", "checkout->pay-api", "checkout->login", "pay-api->stripe", "pay-api->adyen"]);
    expect((one.match(/class="step-note"/g) ?? []).length).toBe(1); // one caption in the still
  });
  it("activeView keeps only the first frame of a crossfading tour of different views", async () => {
    const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid/drill-down.json"), "utf8")));
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const svg = await render(r.model, new FakeLayoutEngine(), { tour: { views: ["overview", "payments"] } });
    expect((activeView(svg).match(/<g class="tour"/g) ?? []).length).toBe(1);
  });
});
