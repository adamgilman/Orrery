import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeLayoutEngine, renderDocument, validate, type Model } from "../src/index.js";

const fixture = (name: string): Model => { const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid", `${name}.json`), "utf8"))); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.model; };
const engine = () => new FakeLayoutEngine();

describe("renderDocument", () => {
  it("embeds every view as a layer, first visible, with sizes; --view reorders", async () => {
    const svg = await renderDocument(fixture("grouped"), engine(), { runtime: "/*rt*/" });
    const layers = [...svg.matchAll(/<g class="view"( style="display:none")? data-view="([^"]+)" data-open="" data-title="([^"]*)" data-size="([\d.]+) ([\d.]+)">/g)];
    expect(layers.map((m) => m[2])).toEqual(["overview", "data-tier"]);
    expect(layers[0]![1]).toBeUndefined();
    expect(layers[1]![1]).toBe(' style="display:none"');
    const re = await renderDocument(fixture("grouped"), engine(), { runtime: "", view: "data-tier" });
    expect([...re.matchAll(/data-view="([^"]+)"/g)].map((m) => m[1])).toEqual(["data-tier", "overview"]);
  });
  it("embeds the normalised model as CDATA-safe JSON, and the runtime after it", async () => {
    const svg = await renderDocument(fixture("own-vocabulary"), engine(), { runtime: "console.log(1)" });
    const json = svg.match(/<script type="application\/json" id="orrery-model"><!\[CDATA\[([\s\S]*?)\]\]><\/script>/)![1]!;
    const model = JSON.parse(json);
    expect(Object.keys(model.states.define)).toEqual(["healthy", "impaired", "brownout", "outage", "drained"]);
    expect(model.kinds.connections.gossip).toEqual({ line: { dash: "2 3", stroke: "#0891b2", flow: "#0891b2" }, description: "Consensus gossip between sequencers" });
    expect(model.scenarios[0].steps[0].reasons).toEqual({ edge: "running on cell B alone" });
    expect(svg).toMatch(/<script><!\[CDATA\[console\.log\(1\)\]\]><\/script>\s*<\/svg>/);
  });
  it("embeds only the kinds and shapes the model uses, so a pack does not travel whole (R13)", async () => {
    const svg = await renderDocument(fixture("cloud"), engine(), { runtime: "" });
    const json = svg.match(/<script type="application\/json" id="orrery-model"><!\[CDATA\[([\s\S]*?)\]\]><\/script>/)![1]!;
    const model = JSON.parse(json);
    expect(Object.keys(model.kinds.components).sort()).toEqual(["aws:cloudfront", "aws:lambda", "aws:rds", "aws:s3", "client"]);
    expect(Object.keys(model.kinds.groups)).toEqual(["aws:vpc"]);
    expect(Object.keys(model.kinds.connections)).toEqual(["sync"]);
    expect(Object.keys(model.shapes)).toEqual(["box", "pill"]);
    expect(json.length).toBeLessThan(20000);
  });
  it("is deterministic and gives nodes and groups a data-bbox", async () => {
    const a = await renderDocument(fixture("grouped"), engine(), { runtime: "x" });
    expect(a).toBe(await renderDocument(fixture("grouped"), engine(), { runtime: "x" }));
    expect(a).toMatch(/data-node="api"[^>]*data-bbox="[\d.]+ [\d.]+ [\d.]+ [\d.]+"/);
    expect(a).toMatch(/data-group="app" data-bbox="[\d.]+ [\d.]+ [\d.]+ [\d.]+"/);
  });
});
