import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeLayoutEngine, renderDocument, validate } from "@orrery/core";
import { activeView, flowRegions, inspect } from "../src/index.js";

const grouped = async () => {
  const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid/grouped.json"), "utf8")));
  if (!r.ok) throw new Error();
  return renderDocument(r.diagram, new FakeLayoutEngine(), { runtime: "var x = 1; /* ]]> */" });
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
    expect(report.edges.map((e) => e.key)).toEqual(["web->api", "api->db", "api-reads", "db->replica"]);
  });
});
