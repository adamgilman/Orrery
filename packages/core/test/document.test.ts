import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeLayoutEngine, renderDocument, validate, type Diagram } from "../src/index.js";

const fixture = (name: string): Diagram => {
  const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid", `${name}.json`), "utf8")));
  if (!r.ok) throw new Error(name);
  return r.diagram;
};
const engine = () => new FakeLayoutEngine();

describe("renderDocument", () => {
  it("embeds every view as a layer, first visible, others hidden, each with its size", async () => {
    const svg = await renderDocument(fixture("grouped"), engine(), { runtime: "/*rt*/" });
    const layers = [...svg.matchAll(/<g class="view" data-view="([^"]+)" data-title="([^"]*)" data-size="([\d.]+) ([\d.]+)"([^>]*)>/g)];
    expect(layers.map((m) => m[1])).toEqual(["overview", "data-tier"]);
    expect(layers[0]![5]).not.toContain("display:none");
    expect(layers[1]![5]).toContain('style="display:none"');
    expect(layers[1]![2]).toBe("Data tier");
    const [, w, h] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!;
    expect(`${w} ${h}`).toBe(`${layers[0]![3]} ${layers[0]![4]}`);
  });
  it("keeps the static single-view file identical in structure to renderSvg for the first view", async () => {
    const svg = await renderDocument(fixture("three-tier"), engine(), { runtime: "" });
    expect(svg).toContain('data-node="web"');
    expect(svg).toContain("@keyframes orrery-flow");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });
  it("embeds the propagated base model as JSON the runtime can parse, CDATA-safe", async () => {
    const d = fixture("failover");
    const svg = await renderDocument(d, engine(), { runtime: "" });
    const json = svg.match(/<script type="application\/json" id="orrery-model"><!\[CDATA\[([\s\S]*?)\]\]><\/script>/)![1]!;
    const model = JSON.parse(json);
    expect(model.nodes.map((n: { id: string }) => n.id)).toEqual(["api", "db", "replica", "legacy"]);
    expect(model.scenarios[0].id).toBe("db-failover");
    expect(model.views[0].id).toBe("default");
    expect(json).not.toContain("]]>");
  });
  it("escapes a model that contains the CDATA terminator", async () => {
    const r = validate({ nodes: [{ id: "a", label: "x ]]> y" }], edges: [] });
    if (!r.ok) throw new Error();
    const svg = await renderDocument(r.diagram, engine(), { runtime: "" });
    const json = svg.match(/id="orrery-model"><!\[CDATA\[([\s\S]*?)\]\]><\/script>/)![1]!;
    expect(JSON.parse(json).nodes[0].label).toBe("x ]]> y");
  });
  it("embeds the runtime script in CDATA after the model, and none when runtime is empty", async () => {
    const withRt = await renderDocument(fixture("minimal"), engine(), { runtime: "console.log('hi')" });
    expect(withRt).toMatch(/id="orrery-model">[\s\S]*<script><!\[CDATA\[console\.log\('hi'\)\]\]><\/script>\s*<\/svg>/);
    const noRt = await renderDocument(fixture("minimal"), engine(), { runtime: "" });
    expect(noRt).not.toMatch(/<script><!\[CDATA\[/);
  });
  it("gives nodes and groups a data-bbox in view coordinates so the runtime never needs getBBox", async () => {
    const svg = await renderDocument(fixture("grouped"), engine(), { runtime: "" });
    expect(svg).toMatch(/<g class="node[^"]*" data-node="api"[^>]*data-bbox="[\d.]+ [\d.]+ [\d.]+ [\d.]+"/);
    expect(svg).toMatch(/<g class="group[^"]*" data-group="app" data-bbox="[\d.]+ [\d.]+ [\d.]+ [\d.]+"/);
  });
  it("is deterministic", async () => {
    const a = await renderDocument(fixture("grouped"), engine(), { runtime: "x" });
    const b = await renderDocument(fixture("grouped"), engine(), { runtime: "x" });
    expect(a).toBe(b);
  });
});
