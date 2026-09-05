import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeLayoutEngine, renderDocument, validate, type Model } from "../src/index.js";

const fixture = (name: string): Model => { const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid", `${name}.json`), "utf8"))); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.model; };
const engine = () => new FakeLayoutEngine();

describe("renderDocument", () => {
  it("embeds every view as a layer, first visible, with sizes; --view reorders", async () => {
    const svg = await renderDocument(fixture("grouped"), engine(), { runtime: "/*rt*/" });
    const layers = [...svg.matchAll(/<g class="view" data-view="([^"]+)" data-title="([^"]*)" data-size="([\d.]+) ([\d.]+)"([^>]*)>/g)];
    expect(layers.map((m) => m[1])).toEqual(["overview", "data-tier"]);
    expect(layers[1]![5]).toContain('style="display:none"');
    const re = await renderDocument(fixture("grouped"), engine(), { runtime: "", view: "data-tier" });
    expect([...re.matchAll(/data-view="([^"]+)"/g)].map((m) => m[1])).toEqual(["data-tier", "overview"]);
  });
  it("embeds the normalised model as CDATA-safe JSON, and the runtime after it", async () => {
    const svg = await renderDocument(fixture("own-vocabulary"), engine(), { runtime: "console.log(1)" });
    const json = svg.match(/<script type="application\/json" id="orrery-model"><!\[CDATA\[([\s\S]*?)\]\]><\/script>/)![1]!;
    const model = JSON.parse(json);
    expect(Object.keys(model.states.define)).toEqual(["healthy", "impaired", "brownout", "outage", "drained"]);
    expect(model.components[0].needs[0]).toEqual({ any: ["cell-a", "cell-b"], min: 1, unmet: "outage", reduced: "impaired" });
    expect(svg).toMatch(/<script><!\[CDATA\[console\.log\(1\)\]\]><\/script>\s*<\/svg>/);
  });
  it("is deterministic and gives nodes and groups a data-bbox", async () => {
    const a = await renderDocument(fixture("grouped"), engine(), { runtime: "x" });
    expect(a).toBe(await renderDocument(fixture("grouped"), engine(), { runtime: "x" }));
    expect(a).toMatch(/data-node="api"[^>]*data-bbox="[\d.]+ [\d.]+ [\d.]+ [\d.]+"/);
    expect(a).toMatch(/data-group="app" data-bbox="[\d.]+ [\d.]+ [\d.]+ [\d.]+"/);
  });
});
