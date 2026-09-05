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
    expect(m.components[0]).toMatchObject({ id: "a", label: "a", kind: "service", state: "on", needs: [], replicas: 1 });
    expect(m.connections).toEqual([]);
    expect(m.groups).toEqual([]);
    expect(m.views).toEqual([{ id: "default", type: "topology", direction: "right" }]);
    expect(m.scenarios).toEqual([]);
    expect(Object.keys(m.states.define)).toEqual(["on", "degraded", "failed", "off"]);
    expect(m.states).toMatchObject({ default: "on", needs: { unmet: "failed", reduced: "degraded" } });
    expect(Object.keys(m.kinds.components)).toContain("database");
    expect(Object.keys(m.kinds.groups)).toContain("boundary");
  });
  it("normalises needs to objects with document outcomes, and connections to keys", () => {
    const m = model("alternatives");
    const api = m.components.find((c) => c.id === "api")!;
    expect(api.needs[0]).toEqual({ any: ["orders", "replica"], min: 1, unmet: "failed", reduced: "degraded" });
    expect(api.needs[2]).toEqual({ any: ["fraud"], min: 1, unmet: "degraded", reduced: "degraded" });
    const web = m.components.find((c) => c.id === "web")!;
    expect(web.needs[0]).toEqual({ any: ["api"], min: 1, unmet: "failed", reduced: "degraded" });
    expect(m.connections[0]!.key).toBe("web->api");
    expect(m.connections[0]!.id).toBeUndefined();
    expect(model("parallel").connections.map((c) => c.key)).toEqual(["reads", "writes"]);
    expect(model("parallel").scenarios[0]!.steps[0]!.load).toEqual({ writes: 0.9 });
  });
  it("resolves scenario set/restore/load into normalised steps", () => {
    const m = model("alternatives");
    const s = m.scenarios[0]!;
    expect(s.steps[0]).toEqual({ note: "Primary goes down; reads move to the replica, API runs reduced", set: { failed: ["orders"] }, restore: [], load: {} });
    expect(s.steps[3]!.restore).toEqual(["orders", "fraud", "replica"]);
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
  it("replace: true keeps only the author's states and requires default and outcomes to be named", () => {
    const m = model("own-vocabulary");
    expect(Object.keys(m.states.define)).toEqual(["healthy", "impaired", "brownout", "outage", "drained"]);
    expect(m.states.default).toBe("healthy");
    expect(m.components.find((c) => c.id === "edge")!.state).toBe("healthy");
    expect(m.states.define.brownout!.look).toEqual({ stroke: "#7c3aed", fill: "#f5f3ff", pulse: true });
    expect(m.states.define.drained!.cascade).toBe("children");
    expect(m.kinds.components.matcher!.glyph).toMatch(/^M/);
    expect(m.kinds.groups.cell!.frame).toMatchObject({ dash: true });
    expect(m.kinds.components.database).toBeDefined(); // kinds not replaced, only extended
  });
  it("overriding a default state merges onto its definition rather than resetting it", () => {
    const r = validate({ states: { define: { degraded: { cascade: "children" } } }, components: [{ id: "a" }] });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.model.states.define.degraded).toMatchObject({ look: "warn", rank: 1, available: true, cascade: "children" });
  });
  it("extending adds a state with schema defaults", () => {
    const r = validate({ states: { define: { maintenance: { look: "muted", available: false } } }, components: [{ id: "a", state: "maintenance" }] });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.model.states.define.maintenance).toMatchObject({ look: "muted", rank: 1, available: false, flows: "keep", cascade: "none" });
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
