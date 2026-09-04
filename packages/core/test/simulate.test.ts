import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyScenario, propagate, validate, type Diagram } from "../src/index.js";

const failover = (): Diagram => {
  const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid/failover.json"), "utf8")));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.diagram;
};
const withStates = (d: Diagram, states: Record<string, Diagram["nodes"][number]["state"]>): Diagram => ({
  ...d,
  nodes: d.nodes.map((n) => (states[n.id] ? { ...n, state: states[n.id]! } : n)),
});
const node = (d: Diagram, id: string) => d.nodes.find((n) => n.id === id)!;
const edge = (d: Diagram, id: string) => d.edges.find((e) => e.id === id)!;

describe("propagate", () => {
  it("leaves a healthy model unchanged apart from edges touching an off node", () => {
    const d = propagate(failover());
    expect(node(d, "api").state).toBe("on");
    expect(node(d, "db").state).toBe("on");
    expect(edge(d, "api->db").load).toBe(0.6);
    expect(edge(d, "api->legacy").load).toBe(0); // legacy is off in the base model
    expect(node(d, "legacy").state).toBe("off");
  });
  it("degrades a dependent that has a healthy fallback, and moves the load onto the fallback edge", () => {
    const d = propagate(withStates(failover(), { db: "failed" }));
    expect(node(d, "api").state).toBe("degraded");
    expect(node(d, "api").reason).toMatch(/db.*replica/i);
    expect(edge(d, "api->db").load).toBe(0);
    expect(edge(d, "api->replica").load).toBe(0.6);
    expect(edge(d, "db->replica").load).toBe(0);
  });
  it("fails a dependent whose fallback is also down", () => {
    const d = propagate(withStates(failover(), { db: "failed", replica: "failed" }));
    expect(node(d, "api").state).toBe("failed");
    expect(node(d, "api").reason).toMatch(/db/i);
    expect(edge(d, "api->replica").load).toBe(0);
  });
  it("propagates transitively through chains of dependsOn edges", () => {
    const r = validate({
      nodes: [{ id: "web" }, { id: "api" }, { id: "db" }],
      edges: [{ from: "web", to: "api", dependsOn: true, load: 0.5 }, { from: "api", to: "db", dependsOn: true, load: 0.5 }],
    });
    if (!r.ok) throw new Error();
    const d = propagate(withStates(r.diagram, { db: "off" }));
    expect(node(d, "api").state).toBe("failed");
    expect(node(d, "web").state).toBe("failed");
    expect(node(d, "db").state).toBe("off"); // off stays off, it is not red
    expect(edge(d, "web->api").load).toBe(0);
  });
  it("a degraded target degrades its dependents; failure outranks degradation", () => {
    const d = propagate(withStates(failover(), { db: "degraded" }));
    expect(node(d, "api").state).toBe("degraded");
    expect(edge(d, "api->db").load).toBe(0.6);
    expect(edge(d, "api->replica").load).toBe(0); // fallback only activates when the primary is down
  });
  it("edges that are not dependsOn never propagate", () => {
    const r = validate({ nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b", load: 0.5 }] });
    if (!r.ok) throw new Error();
    const d = propagate(withStates(r.diagram, { b: "failed" }));
    expect(node(d, "a").state).toBe("on");
    expect(edge(d, "a->b").load).toBe(0);
  });
  it("terminates on cycles and does not mutate its input", () => {
    const r = validate({ nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b", dependsOn: true }, { from: "b", to: "a", dependsOn: true }] });
    if (!r.ok) throw new Error();
    const input = withStates(r.diagram, { a: "failed" });
    const copy = structuredClone(input);
    const d = propagate(input);
    expect(node(d, "b").state).toBe("failed");
    expect(input).toEqual(copy);
  });
});

describe("applyScenario", () => {
  it("applies steps cumulatively and propagates", () => {
    const d = failover();
    const s1 = applyScenario(d, "db-failover", 1);
    expect(node(s1.diagram, "db").state).toBe("failed");
    expect(node(s1.diagram, "api").state).toBe("degraded");
    expect(s1.note).toBe("Primary goes down");
    const s2 = applyScenario(d, "db-failover", 2);
    expect(node(s2.diagram, "db").state).toBe("failed"); // still failed from step 1
    expect(edge(s2.diagram, "api->replica").load).toBe(0.6);
    const s3 = applyScenario(d, "db-failover", 3);
    expect(node(s3.diagram, "db").state).toBe("degraded");
    expect(node(s3.diagram, "api").state).toBe("degraded");
    expect(s3.step).toBe(3);
    expect(s3.steps).toBe(3);
  });
  it("defaults to the last step", () => {
    expect(applyScenario(failover(), "db-failover").step).toBe(3);
  });
  it("rejects unknown scenarios and out-of-range steps with helpful messages", () => {
    expect(() => applyScenario(failover(), "nope")).toThrow(/unknown scenario "nope".*db-failover/);
    expect(() => applyScenario(failover(), "db-failover", 0)).toThrow(/step must be between 1 and 3/);
    expect(() => applyScenario(failover(), "db-failover", 4)).toThrow(/step must be between 1 and 3/);
  });
});

describe("propagate: fallbackFor and soft dependencies", () => {
  const twoDeps = (): Diagram => {
    const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid/two-deps.json"), "utf8")));
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.diagram;
  };
  it("activates only the fallback that covers the failed dependency", () => {
    const d = propagate(withStates(twoDeps(), { db: "failed" }));
    expect(node(d, "svc").state).toBe("degraded");
    expect(edge(d, "svc->replica").load).toBe(0.8);
    expect(edge(d, "svc->adyen").load).toBe(0);   // stripe is fine, adyen stays idle
    expect(edge(d, "svc->stripe").load).toBe(0.5);
  });
  it("fails the source when a failed dependency has no covering fallback, even if another fallback is healthy", () => {
    const base = twoDeps();
    const noCover: Diagram = { ...base, edges: base.edges.filter((e) => e.id !== "svc->replica") };
    const d = propagate(withStates(noCover, { db: "failed" }));
    expect(node(d, "svc").state).toBe("failed");
    expect(edge(d, "svc->adyen").load).toBe(0);
  });
  it("a soft dependency degrades the source instead of failing it", () => {
    const d = propagate(withStates(twoDeps(), { fraud: "failed" }));
    expect(node(d, "svc").state).toBe("degraded");
    expect(node(d, "svc").reason).toMatch(/fraud/);
    expect(edge(d, "svc->fraud").load).toBe(0);
  });
  it("two failed dependencies, both covered, still only degrade", () => {
    const d = propagate(withStates(twoDeps(), { db: "failed", stripe: "failed" }));
    expect(node(d, "svc").state).toBe("degraded");
    expect(edge(d, "svc->replica").load).toBe(0.8);
    expect(edge(d, "svc->adyen").load).toBe(0.5);
  });
});
