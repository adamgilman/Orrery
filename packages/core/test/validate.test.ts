import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validate } from "../src/index.js";

const fixtures = join(import.meta.dirname, "../../../fixtures");
const load = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const names = (dir: string) =>
  readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".errors.json")).map((f) => f.replace(/\.json$/, ""));

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
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.map((e) => e.pointer).sort()).toEqual(expected.map((e) => e.pointer).sort());
      for (const exp of expected) {
        const match = result.errors.find((e) => e.pointer === exp.pointer && e.message.includes(exp.message));
        expect(match, `expected ${exp.pointer} to contain "${exp.message}", got ${JSON.stringify(result.errors)}`).toBeDefined();
      }
    });
  }
});

describe("validate: normalisation", () => {
  it("applies defaults for direction, load and label", () => {
    const result = validate({ nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagram.direction).toBe("right");
    expect(result.diagram.nodes[0]?.label).toBe("a");
    expect(result.diagram.edges[0]?.load).toBe(0.5);
  });

  it("does not mutate its input", () => {
    const input = { nodes: [{ id: "a" }], edges: [] };
    const copy = structuredClone(input);
    validate(input);
    expect(input).toEqual(copy);
  });

  it("formats errors as pointer: message lines", () => {
    const result = validate({ nodes: [{ id: "a" }], edges: [{ from: "a", to: "nope" }] });
    if (result.ok) throw new Error("expected failure");
    expect(result.errors[0]?.toString()).toBe('/edges/0/to: unknown node "nope"');
  });
});

describe("validate: model and views normalisation", () => {
  const grouped = () => {
    const r = validate(load(join(fixtures, "valid", "grouped.json")));
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.diagram;
  };
  it("defaults edge id to from->to and keeps explicit ids", () => {
    const d = grouped();
    expect(d.edges.map((e) => e.id)).toEqual(["web->api", "api->db", "api-reads", "db->replica"]);
  });
  it("defaults kinds", () => {
    const d = grouped();
    expect(d.nodes.find((n) => n.id === "web")?.kind).toBe("gateway");
    expect(d.edges[0]?.kind).toBe("sync");
    expect(d.groups[0]?.kind).toBe("region");
    const r = validate({ nodes: [{ id: "a" }], edges: [], groups: [{ id: "g" }] });
    if (!r.ok) throw new Error();
    expect(r.diagram.nodes[0]?.kind).toBe("service");
    expect(r.diagram.groups[0]).toEqual({ id: "g", label: "g", kind: "tier" });
  });
  it("synthesises one topology view of everything when views are absent", () => {
    const r = validate({ direction: "down", nodes: [{ id: "a" }], edges: [] });
    if (!r.ok) throw new Error();
    expect(r.diagram.views).toEqual([{ id: "default", type: "topology", direction: "down" }]);
  });
  it("fills view defaults from the top level and keeps scope", () => {
    const d = grouped();
    expect(d.views[0]).toEqual({ id: "overview", type: "topology", direction: "right" });
    expect(d.views[1]).toEqual({ id: "data-tier", type: "topology", direction: "down", title: "Data tier", scope: "data" });
  });
  it("keeps node group and group parent references", () => {
    const d = grouped();
    expect(d.nodes.find((n) => n.id === "api")?.group).toBe("app");
    expect(d.groups.find((g) => g.id === "app")?.parent).toBe("region");
  });
});

describe("validate: states, dependencies, scenarios", () => {
  const failover = () => {
    const r = validate(load(join(fixtures, "valid", "failover.json")));
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.diagram;
  };
  it("defaults node state to on and edge flags to false", () => {
    const d = failover();
    expect(d.nodes.find((n) => n.id === "api")?.state).toBe("on");
    expect(d.nodes.find((n) => n.id === "legacy")?.state).toBe("off");
    expect(d.edges[0]).toMatchObject({ dependsOn: true, fallback: false });
    expect(d.edges[2]).toMatchObject({ dependsOn: false, fallback: false });
  });
  it("normalises scenarios with cumulative steps and empty maps", () => {
    const d = failover();
    expect(d.scenarios).toHaveLength(1);
    const s = d.scenarios[0]!;
    expect(s.label).toBe("Primary DB fails");
    expect(s.steps[0]).toEqual({ note: "Primary goes down", nodes: { db: { state: "failed" } }, edges: {} });
    expect(s.steps[1]).toEqual({ note: "Replica takes reads", nodes: {}, edges: { "api->replica": { load: 0.6 } } });
  });
  it("defaults scenarios to an empty list and label to id", () => {
    const r = validate({ nodes: [{ id: "a" }], edges: [], scenarios: [{ id: "s", steps: [{ nodes: { a: { state: "off" } } }] }] });
    if (!r.ok) throw new Error();
    expect(r.diagram.scenarios[0]?.label).toBe("s");
    const r2 = validate({ nodes: [{ id: "a" }], edges: [] });
    if (!r2.ok) throw new Error();
    expect(r2.diagram.scenarios).toEqual([]);
  });
});
