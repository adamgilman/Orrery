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
  it("is one drawing: the topology views together, or one sequence view alone (R17)", async () => {
    const views = (svg: string) => [...svg.matchAll(/<g class="view"[^>]* data-view="([^"]+)" data-open=""/g)].map((m) => m[1]);
    expect(views(await renderDocument(fixture("sequence"), engine(), { runtime: "" }))).toEqual(["overview"]);
    expect(views(await renderDocument(fixture("sequence"), engine(), { runtime: "", view: "checkout" }))).toEqual(["checkout"]);
    const lookup = await renderDocument(fixture("sequence"), engine(), { runtime: "", view: "lookup" });
    expect(views(lookup)).toEqual(["lookup"]);
    expect(lookup).toContain('data-message="1"');
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

describe("renderDocument: heading (R15)", () => {
  it("carries the heading outside the scene and tells the runtime its height", async () => {
    const svg = await renderDocument(fixture("cloud"), engine(), { runtime: "", heading: true });
    const h = Number(svg.match(/data-heading="([\d.]+)"/)![1]);
    expect(h).toBeGreaterThan(40);
    expect(svg.indexOf('class="heading"')).toBeLessThan(svg.indexOf('class="scene"'));
    expect(await renderDocument(fixture("cloud"), engine(), { runtime: "" })).not.toContain("data-heading");
  });
});

describe("renderDocument: callouts (R16)", () => {
  it("carries every step's callouts in each layer, hidden, for the runtime to show", async () => {
    const r = validate({ components: [{ id: "a" }, { id: "b" }], callouts: [{ at: "a", text: "standing" }], scenarios: [{ id: "s", steps: [{ set: { failed: "a" }, callouts: [{ at: "b", text: "one" }] }, { restore: "a" }] }], views: [{ id: "v" }] });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const svg = await renderDocument(r.model, engine(), { runtime: "" });
    expect(svg).toMatch(/<g class="callouts">\n<g class="callout" data-callout="a"/);
    expect(svg).toMatch(/<g class="callouts-step" data-scenario="s" data-step="1" style="display:none">[\s\S]*data-callout="b"/);
    expect(svg).not.toMatch(/data-scenario="s" data-step="2"/); // nothing to show at step 2
  });
});
