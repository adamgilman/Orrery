import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applySet, declare, propagate, scopeModel, validate, type Model } from "../src/index.js";

const fixture = (name: string): Model => {
  const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid", `${name}.json`), "utf8")));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.model;
};
const st = (m: Model, id: string) => (m.components.find((c) => c.id === id) ?? m.groups.find((g) => g.id === id))!.state;
const reason = (m: Model, id: string) => (m.components.find((c) => c.id === id) ?? m.groups.find((g) => g.id === id))!.reason;
const load = (m: Model, key: string) => m.connections.find((c) => c.key === key)!.load;
const failed = (m: Model, ...ids: string[]) => propagate(applySet(m, { failed: ids }));

describe("propagate: needs (B2, B3, B6)", () => {
  it("a healthy model is unchanged, apart from need markers on connections", () => {
    const m = propagate(fixture("alternatives"));
    expect(m.components.every((c) => c.state === "on")).toBe(true);
    expect(m.connections.find((c) => c.key === "api->orders")!.need).toBe(true);
    expect(m.connections.find((c) => c.key === "orders->replica")!.need).toBeUndefined();
  });
  it("an alternative down: reduced redundancy, load shifts, reason names the alternative in use", () => {
    const m = failed(fixture("alternatives"), "orders");
    expect(st(m, "api")).toBe("degraded");
    expect(reason(m, "api")).toBe("Orders DB unavailable, using Orders replica");
    expect(load(m, "api->orders")).toBe(0);
    expect(load(m, "api->replica")).toBe(0.6);
    expect(load(m, "orders->replica")).toBe(0);
    expect(st(m, "web")).toBe("degraded"); // api is above default rank
    expect(reason(m, "web")).toBe("Checkout API is degraded");
  });
  it("all alternatives down: unmet, the outcome state applies and propagates up the chain", () => {
    const m = failed(fixture("alternatives"), "orders", "replica");
    expect(st(m, "api")).toBe("failed");
    expect(reason(m, "api")).toMatch(/needs Orders DB or Orders replica \(0 of 1 available\)/);
    expect(st(m, "web")).toBe("failed");
    expect(load(m, "web->api")).toBe(0);
  });
  it("a need's own outcome overrides the document default", () => {
    const m = failed(fixture("alternatives"), "fraud");
    expect(st(m, "api")).toBe("degraded");
    expect(load(m, "api->fraud")).toBe(0);
  });
  it("declared state is a floor and the worst outcome wins", () => {
    const m = propagate(applySet(fixture("alternatives"), { degraded: ["api"], failed: ["orders", "replica"] }));
    expect(st(m, "api")).toBe("failed");
    const m2 = propagate(applySet(fixture("alternatives"), { failed: ["api"] }));
    expect(st(m2, "api")).toBe("failed");
    expect(st(m2, "orders")).toBe("on");
  });
  it("is pure, deterministic and terminates on cycles (B1, B5)", () => {
    const base = fixture("cycle");
    const input = applySet(base, { failed: ["a"] });
    const copy = structuredClone(input);
    const m = propagate(input);
    expect(input).toEqual(copy);
    expect(st(m, "b")).toBe("failed");
    expect(propagate(input)).toEqual(m);
  });
});

describe("propagate: groups and cascade (B8, B9)", () => {
  it("a group derives its state from its members through the need mechanic", () => {
    const m = failed(fixture("group-endpoints"), "svc");
    expect(st(m, "platform")).toBe("failed");
    expect(st(m, "edge")).toBe("failed");
    expect(st(m, "empty")).toBe("on"); // empty: declared only
    expect(load(m, "edge->platform")).toBe(0);
  });
  it("an empty group is a black box with its declared state", () => {
    const m = failed(fixture("group-endpoints"), "empty");
    expect(st(m, "empty")).toBe("failed");
    expect(st(m, "edge")).toBe("failed");
  });
  it("a group's failure does not reach its members; a cascading state does", () => {
    const own = fixture("own-vocabulary");
    const outage = propagate(applySet(own, { outage: ["settlement"] }));
    expect(st(outage, "ledger")).toBe("healthy");
    expect(st(outage, "match-a")).toBe("outage");
    const drained = propagate(applySet(own, { drained: ["cell-a"] }));
    expect(st(drained, "match-a")).toBe("drained");
    expect(reason(drained, "match-a")).toBe("Cell A is drained");
    expect(st(drained, "edge")).toBe("impaired");
    expect(load(drained, "edge->cell-b")).toBe(1);
  });
  it("quorum on the component: one sequencer out impairs, two out is an outage", () => {
    const own = fixture("own-vocabulary");
    const one = propagate(applySet(own, { outage: ["seq-1"] }));
    expect(st(one, "match-a")).toBe("impaired");
    expect(st(one, "consensus")).toBe("impaired");
    const two = propagate(applySet(own, { outage: ["seq-1", "seq-2"] }));
    expect(st(two, "match-a")).toBe("outage");
    expect(st(two, "match-b")).toBe("outage");
    expect(st(two, "cell-a")).toBe("outage");
    expect(st(two, "edge")).toBe("outage");
  });
});

describe("propagate: names do not matter (B10)", () => {
  it("renaming every state with the same mechanics yields the same propagation", () => {
    const base = JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid/alternatives.json"), "utf8"));
    const renamed = JSON.parse(JSON.stringify(base).replace(/"failed"/g, '"kaput"').replace(/"degraded"/g, '"wobbly"'));
    renamed.states = { default: "fine", replace: true, needs: { unmet: "kaput", reduced: "wobbly" }, define: {
      fine: { look: "normal", rank: 0 }, wobbly: { look: "warn", rank: 1 },
      kaput: { look: "alert", rank: 2, available: false, flows: "stop" }, gone: { look: "muted", rank: 2, available: false, flows: "stop", cascade: "children" } } };
    const r = validate(renamed); if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const a = failed(fixture("alternatives"), "orders");
    const b = propagate(applySet(r.model, { kaput: ["orders"] }));
    const map: Record<string, string> = { on: "fine", degraded: "wobbly", failed: "kaput", off: "gone" };
    expect(b.components.map((c) => c.state)).toEqual(a.components.map((c) => map[c.state]));
    expect(b.connections.map((c) => c.load)).toEqual(a.connections.map((c) => c.load));
  });
});

describe("scenario steps (B7)", () => {
  const at = (m: Model, scenario: string, step?: number) => { const d = declare(m, { scenario, ...(step !== undefined ? { step } : {}) }); return { ...d, model: propagate(d.model) }; };
  it("applies steps cumulatively, restores to base, and reports the note", () => {
    const m = fixture("alternatives");
    const s1 = at(m, "orders-failover", 1);
    expect(st(s1.model, "api")).toBe("degraded");
    expect(s1.note).toMatch(/Primary goes down/);
    const s2 = at(m, "orders-failover", 2);
    expect(st(s2.model, "orders")).toBe("failed");
    expect(st(s2.model, "api")).toBe("degraded");
    const s3 = at(m, "orders-failover", 3);
    expect(st(s3.model, "api")).toBe("failed");
    expect(st(s3.model, "web")).toBe("failed");
    const s4 = at(m, "orders-failover");
    expect(s4.step).toBe(4);
    expect(s4.steps).toBe(4);
    expect(s4.model.components.every((c) => c.state === "on")).toBe(true);
  });
  it("rejects unknown scenarios and steps out of range", () => {
    expect(() => at(fixture("alternatives"), "nope")).toThrow(/unknown scenario "nope".*orders-failover/);
    expect(() => at(fixture("alternatives"), "orders-failover", 9)).toThrow(/between 1 and 4/);
  });
  it("applySet rejects unknown states and entities", () => {
    expect(() => applySet(fixture("minimal"), { broken: ["a"] })).toThrow(/unknown state "broken"/);
    expect(() => applySet(fixture("minimal"), { failed: ["zzz"] })).toThrow(/unknown entity "zzz"/);
  });
});

describe("propagate: group state is independent of member order (B9)", () => {
  it("a group with one degraded member is reduced whichever member is listed first", () => {
    const build = (order: string[]) => {
      const r = validate({
        groups: [{ id: "edge" }],
        components: [...order.map((id) => ({ id, group: "edge" })), { id: "svc" }],
        connections: [{ from: "svc", to: "edge" }],
        scenarios: [],
      });
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      return r.model;
    };
    for (const order of [["a", "b"], ["b", "a"]]) {
      const m = propagate(applySet(build(order), { degraded: ["a"] }));
      expect(st(m, "edge"), order.join(",")).toBe("degraded");
    }
  });
});

describe("propagate: cascade ties and nesting (B8)", () => {
  const build = (outer: string, inner: string, member: string) => {
    const r = validate({
      states: { define: { drained: { look: "muted", rank: 2, available: false, flows: "stop", cascade: "children" } } },
      groups: [{ id: "outer", state: outer }, { id: "inner", parent: "outer", state: inner }],
      components: [{ id: "x", group: "inner", state: member }],
    });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return propagate(r.model);
  };
  it("a same-rank declared state is kept", () => {
    expect(st(build("off", "on", "failed"), "x")).toBe("failed");
  });
  it("the nearest cascading ancestor wins a tie between cascading ancestors, whatever the group order", () => {
    expect(st(build("off", "drained", "on"), "x")).toBe("drained");
    expect(st(build("drained", "off", "on"), "x")).toBe("off");
  });
});

describe("propagate: loads (B4)", () => {
  it("shifts load off an unavailable alternative that still keeps flow, and sums parallel connections", () => {
    const base = fixture("parallel-needs");
    const r = validate({ ...JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid/parallel-needs.json"), "utf8")),
      states: { define: { readonly: { available: false, flows: "keep", rank: 1 } } } });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const m = propagate(applySet(r.model, { readonly: ["db"] }));
    expect(load(m, "writes")).toBe(0);
    expect(load(m, "reads")).toBe(0);
    expect(load(m, "api->replica")).toBe(0.8);
    expect(m.connections.filter((c) => c.need).map((c) => c.key)).toEqual(["writes", "reads", "api->replica"]);
    expect(base.connections).toHaveLength(3);
  });
  it("marks a connection to a group containing an alternative as satisfying the need, and survives scoping", () => {
    const m = propagate(applySet(fixture("via-group"), { failed: ["q1"] }));
    expect(m.connections[0]!.need).toBe(true);
    expect(st(m, "svc")).toBe("degraded");
    const scoped = propagate(scopeModel(fixture("via-group"), fixture("via-group").views[1]!));
    expect(st(scoped, "svc")).toBe("on");
  });
});
