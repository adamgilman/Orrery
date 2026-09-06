import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validate } from "../src/validate.js";

const fixtures = join(import.meta.dirname, "../../../fixtures");
const load = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const names = (dir: string) => readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".errors.json")).map((f) => f.replace(/\.json$/, ""));
const model = (name: string) => { const r = validate(load(join(fixtures, "valid", `${name}.json`))); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.model; };

describe("validate: valid fixtures", () => {
  for (const name of names(join(fixtures, "valid"))) {
    it(`${name} is accepted`, () => {
      const result = validate(load(join(fixtures, "valid", `${name}.json`)));
      expect(result.ok, JSON.stringify(result)).toBe(true);
    });
  }
});

describe("validate: invalid fixtures", () => {
  for (const name of names(join(fixtures, "invalid"))) {
    it(`${name} is rejected with the expected pointers`, () => {
      const expected: { pointer: string; message: string }[] = load(join(fixtures, "invalid", `${name}.errors.json`));
      const result = validate(load(join(fixtures, "invalid", `${name}.json`)));
      expect(result.ok, "expected rejection").toBe(false);
      if (result.ok) return;
      expect(result.errors.map((e) => e.pointer).sort()).toEqual(expected.map((e) => e.pointer).sort());
      for (const exp of expected) {
        const match = result.errors.find((e) => e.pointer === exp.pointer && e.message.includes(exp.message));
        expect(match, `expected ${exp.pointer} to contain "${exp.message}", got ${JSON.stringify(result.errors)}`).toBeDefined();
      }
    });
  }
});

describe("validate: normalisation (S12, defaults)", () => {
  it("a file of components alone is valid and fully defaulted", () => {
    const m = model("minimal");
    expect(m.components[0]).toMatchObject({ id: "a", label: "a", kind: "service", state: "on", replicas: 1 });
    expect(m.connections).toEqual([]);
    expect(m.groups).toEqual([]);
    expect(m.views).toEqual([{ id: "default", type: "topology", direction: "right" }]);
    expect(m.scenarios).toEqual([]);
    expect(Object.keys(m.states.define)).toEqual(["on", "degraded", "failed", "off"]);
    expect(m.states).toMatchObject({ default: "on" });
    expect(m.states.define.failed).toEqual({ name: "failed", look: "alert", flows: "stop", description: "Broken" });
    expect(Object.keys(m.kinds.components)).toContain("database");
    expect(Object.keys(m.kinds.groups)).toContain("boundary");
    expect(Object.keys(m.kinds.connections)).toEqual(["sync", "async", "replication", "dataflow"]);
  });
  it("normalises connections to keys and kinds", () => {
    const m = model("alternatives");
    expect(m.connections[0]!.key).toBe("web->api");
    expect(m.connections[0]!.kind).toBe("sync");
    expect(m.connections[0]!.id).toBeUndefined();
    expect(model("parallel").connections.map((c) => c.key)).toEqual(["reads", "writes"]);
    expect(model("parallel").scenarios[0]!.steps[0]!.load).toEqual({ writes: 0.9 });
  });
  it("resolves scenario set/restore/load into normalised steps: ids, lists, and ids with reasons (S9)", () => {
    const m = model("alternatives");
    const s = m.scenarios[0]!;
    expect(s.steps[0]).toEqual({
      note: "Primary goes down; reads move to the replica, API runs reduced",
      set: { failed: ["orders"], degraded: ["api", "web"] },
      reasons: { api: "reads from the replica", web: "checkout is slower" },
      restore: [], load: { "api->replica": 0.6 },
    });
    expect(s.steps[3]!.restore).toEqual(["orders", "fraud", "replica", "api", "web"]);
    expect(s.steps[3]!.reasons).toEqual({});
    const bad = validate({ components: [{ id: "a" }], scenarios: [{ id: "s", steps: [{ set: { failed: { a: "x" }, off: "a" } }] }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.map((e) => e.toString())).toEqual(['/scenarios/0/steps/0/set/off: "a" is already set to "failed" in this step']);
  });
  it("does not mutate its input and formats errors as pointer: message", () => {
    const input = { components: [{ id: "a" }], connections: [{ from: "a", to: "nope" }] };
    const copy = structuredClone(input);
    const r = validate(input);
    expect(input).toEqual(copy);
    if (r.ok) throw new Error();
    expect(r.errors[0]!.toString()).toBe('/connections/0/to: unknown entity "nope"');
  });
});

describe("validate: vocabulary (S14)", () => {
  it("replace: true keeps only the author's states and requires the default to be named", () => {
    const m = model("own-vocabulary");
    expect(Object.keys(m.states.define)).toEqual(["healthy", "impaired", "brownout", "outage", "drained"]);
    expect(m.states.default).toBe("healthy");
    expect(m.components.find((c) => c.id === "edge")!.state).toBe("healthy");
    expect(m.states.define.brownout!.look).toEqual({ stroke: "#7c3aed", fill: "#f5f3ff", pulse: true });
    expect(m.states.define.drained!.flows).toBe("stop");
    expect(m.kinds.components.matcher!.glyph).toMatch(/^M/);
    expect(m.kinds.groups.cell!.frame).toMatchObject({ dash: true });
    expect(m.kinds.components.database).toBeDefined(); // kinds not replaced, only extended
    expect(m.kinds.connections.gossip).toEqual({ line: { dash: "2 3", stroke: "#0891b2", flow: "#0891b2" }, description: "Consensus gossip between sequencers" });
    expect(m.kinds.connections.sync).toBeDefined();
    expect(m.connections.find((c) => c.key === "seq-1->seq-2")!.kind).toBe("gossip");
  });
  it("overriding a default state or connection kind merges onto its definition rather than resetting it", () => {
    const r = validate({ states: { define: { degraded: { flows: "stop" } } }, kinds: { connections: { async: { description: "fire and forget" } } }, components: [{ id: "a" }] });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.model.states.define.degraded).toMatchObject({ look: "warn", flows: "stop", description: "Working with reduced redundancy or capacity" });
    expect(r.model.kinds.connections.async).toEqual({ line: "dashed", description: "fire and forget" });
  });
  it("extending adds a state with defaults, and a connection kind with a preset or custom line", () => {
    const r = validate({ states: { define: { maintenance: { look: "muted" } } }, kinds: { connections: { depends: { line: "heavy" } } }, components: [{ id: "a", state: "maintenance" }, { id: "b" }], connections: [{ from: "a", to: "b", kind: "depends" }] });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.model.states.define.maintenance).toEqual({ name: "maintenance", look: "muted", flows: "keep" });
    expect(r.model.connections[0]!.kind).toBe("depends");
  });
});

describe("validate: warnings", () => {
  it("warns, without failing, when a source connects to a group and to something inside it", () => {
    const r = validate(load(join(fixtures, "valid", "warning-double.json")));
    if (!r.ok) throw new Error();
    expect(r.warnings.map((w) => w.toString())).toEqual([
      '/connections/1: "x" connects to "m" and also to its group "g"; both lines will be drawn',
      '/connections/2: "m" connects to "x" and so does its group "g"; both lines will be drawn',
    ]);
    expect(model("alternatives") && validate(load(join(fixtures, "valid", "alternatives.json")))).toMatchObject({ warnings: [] });
  });
});

describe("validate: exports (S16)", () => {
  it("normalises exports: the first view by default, play with its seconds, a set with reasons, a tour entry alone", () => {
    const m = model("alternatives");
    expect(m.exports).toEqual([
      { id: "overview", view: "overview" },
      { id: "orders-down", view: "overview", scenario: "orders-failover", step: 1 },
      { id: "failover-loop", view: "overview", play: { scenario: "orders-failover", seconds: 2 } },
      { id: "what-if", view: "overview", set: { failed: ["fraud"], degraded: ["api"] }, reasons: { api: "no fraud scoring" } },
    ]);
    expect(model("nested-drill").exports.map((x) => x.id)).toEqual(["overview", "inside-outer", "inside-inner", "story"]);
    expect(model("nested-drill").exports[2]).toEqual({ id: "inside-inner", view: "overview", open: ["outer", "inner"], zoom: "inner" });
    expect(model("nested-drill").exports[3]).toEqual({ id: "story", view: "overview", tour: true });
    expect(model("nested-drill").tour!.scenes[2]).toMatchObject({ open: ["outer", "inner"], zoom: "inner" });
    expect(model("minimal").exports).toEqual([]);
  });
});

describe("validate: namespaced kinds and glyph objects", () => {
  it("accepts a namespaced kind name and an icon glyph object", () => {
    const r = validate({ kinds: { components: { "acme:bucket": { glyph: { viewBox: "0 0 64 64", svg: '<path fill="#7aa116" d="M0 0h64v64H0z"/>' } } } }, components: [{ id: "a", kind: "acme:bucket" }] });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) expect(r.model.kinds.components["acme:bucket"]!.glyph).toEqual({ viewBox: "0 0 64 64", svg: '<path fill="#7aa116" d="M0 0h64v64H0z"/>' });
  });
  it("rejects a glyph object with a bad viewBox or unsafe markup", () => {
    const bad = (glyph: unknown) => { const r = validate({ kinds: { components: { k: { glyph } } }, components: [{ id: "a" }] }); return r.ok ? [] : r.errors.map((e) => e.toString()); };
    expect(bad({ viewBox: "big", svg: "<path/>" })).toEqual(['/kinds/components/k/glyph/viewBox: must be four numbers, like "0 0 64 64"']);
    expect(bad({ viewBox: "0 0 64 64", svg: '<path onclick="x()"/>' })).toEqual(["/kinds/components/k/glyph/svg: must be plain SVG markup: no script, foreignObject, image, style or event handlers"]);
    expect(bad({ viewBox: "0 0 64 64", svg: "<script>1</script>" })).toHaveLength(1);
    expect(bad({ viewBox: "0 0 64 64" })).toEqual(['/kinds/components/k/glyph: missing required property "svg"']);
  });
});

describe("validate: descriptions and headings (R15)", () => {
  it("keeps the model's and a view's description, and an export's heading, including on a tour export", () => {
    const r = validate({ title: "T", description: "About the system", views: [{ id: "v", description: "About this view" }], tour: { seconds: 2, scenes: [{ view: "v" }, { view: "v", note: "again" }] }, exports: [{ id: "a", heading: true }, { id: "b", tour: true, heading: "left" }], components: [{ id: "x" }] });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.model.description).toBe("About the system");
    expect(r.model.views[0]!.description).toBe("About this view");
    expect(r.model.exports.map((x) => x.heading)).toEqual([true, "left"]);
  });
});
