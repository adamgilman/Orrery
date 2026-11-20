import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { declare, validate, type Model } from "../src/index.js";
import { applySet, stopFlows } from "../src/internal.js";

const fixture = (name: string): Model => {
  const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid", `${name}.json`), "utf8")));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.model;
};
const entity = (m: Model, id: string) => (m.components.find((c) => c.id === id) ?? m.groups.find((g) => g.id === id))!;
const st = (m: Model, id: string) => entity(m, id).state;
const reason = (m: Model, id: string) => entity(m, id).reason;
const load = (m: Model, key: string) => m.connections.find((c) => c.key === key)!.load;
const at = (m: Model, scenario: string, step?: number) => declare(m, { scenario, ...(step !== undefined ? { step } : {}) });

describe("declare: scenario steps (B2)", () => {
  it("applies steps cumulatively with the author's states, reasons and loads; restore returns to base and drops reasons", () => {
    const m = fixture("alternatives");
    const s1 = at(m, "orders-failover", 1);
    expect(st(s1.model, "orders")).toBe("failed");
    expect(st(s1.model, "api")).toBe("degraded");
    expect(reason(s1.model, "api")).toBe("reads from the replica");
    expect(reason(s1.model, "orders")).toBeUndefined();
    expect(load(s1.model, "api->replica")).toBe(0.6);
    expect(s1.note).toMatch(/Primary goes down/);
    const s2 = at(m, "orders-failover", 2);
    expect(st(s2.model, "fraud")).toBe("failed");
    expect(st(s2.model, "api")).toBe("degraded"); // still, from step 1
    const s3 = at(m, "orders-failover", 3);
    expect(st(s3.model, "api")).toBe("failed");
    expect(reason(s3.model, "api")).toBe("no database left"); // a later set replaces the reason
    const s4 = at(m, "orders-failover");
    expect(s4.step).toBe(4);
    expect(s4.steps).toBe(4);
    expect(s4.model.components.every((c) => c.state === "on" && c.reason === undefined)).toBe(true);
    expect(load(s4.model, "api->replica")).toBe(0);
  });
  it("a what-if applies after the scenario position and replaces the reason of what it sets", () => {
    const m = fixture("alternatives");
    const d = declare(m, { scenario: "orders-failover", step: 1, set: { on: ["orders"] }, reasons: { orders: "back already" } });
    expect(st(d.model, "orders")).toBe("on");
    expect(reason(d.model, "orders")).toBe("back already");
    expect(st(d.model, "api")).toBe("degraded"); // the step's word stands
    const plain = declare(m, { set: { degraded: ["api"] } });
    expect(reason(plain.model, "api")).toBeUndefined();
  });
  it("rejects unknown scenarios, steps out of range, unknown states and entities", () => {
    expect(() => at(fixture("alternatives"), "nope")).toThrow(/unknown scenario "nope".*orders-failover/);
    expect(() => at(fixture("alternatives"), "orders-failover", 9)).toThrow(/between 1 and 4/);
    expect(() => applySet(fixture("minimal"), { broken: ["a"] })).toThrow(/unknown state "broken"/);
    expect(() => applySet(fixture("minimal"), { failed: ["zzz"] })).toThrow(/unknown entity or connection id "zzz"/);
  });
});

describe("declare: nothing is inferred (B3)", () => {
  it("an entity no step names keeps its base state whatever happens around it", () => {
    const m = fixture("grouped");
    const d = declare(m, { set: { failed: ["db", "replica"] } }).model;
    expect(st(d, "api")).toBe("on");
    expect(st(d, "web")).toBe("on");
    expect(st(d, "data")).toBe("on"); // the group's state is its own
    expect(reason(d, "api")).toBeUndefined();
  });
  it("setting a group says nothing about its members, and vice versa", () => {
    const own = fixture("own-vocabulary");
    const g = declare(own, { set: { drained: ["cell-a"] } }).model;
    expect(st(g, "cell-a")).toBe("drained");
    expect(st(g, "match-a")).toBe("healthy");
    const c = declare(own, { set: { outage: ["seq-1", "seq-2", "seq-3"] } }).model;
    expect(st(c, "consensus")).toBe("healthy");
  });
});

describe("declare: flow (B4)", () => {
  it("a connection touching an entity whose state stops flows is drawn with load 0; every other load is as declared", () => {
    const m = fixture("alternatives");
    const d = stopFlows(declare(m, { scenario: "orders-failover", step: 1 }).model);
    expect(load(d, "api->orders")).toBe(0); // failed stops flow
    expect(load(d, "orders->replica")).toBe(0);
    expect(load(d, "api->replica")).toBe(0.6); // the author moved it here
    expect(load(d, "web->api")).toBe(0.8); // degraded keeps flow
    const off = stopFlows(declare(m, { set: { off: ["fraud"] } }).model);
    expect(load(off, "api->fraud")).toBe(0);
    expect(load(off, "api->orders")).toBe(0.6);
  });
  it("a state that keeps flows leaves loads alone, and a group's state applies to its own connections", () => {
    const own = fixture("own-vocabulary");
    const d = stopFlows(declare(own, { set: { drained: ["cell-a"], impaired: ["edge"] } }).model);
    expect(load(d, "edge->cell-a")).toBe(0);
    expect(load(d, "edge->cell-b")).toBe(own.connections.find((c) => c.key === "edge->cell-b")!.load);
  });
});

describe("declare: pure (B1)", () => {
  it("never mutates its input and is deterministic", () => {
    const m = fixture("alternatives");
    const copy = structuredClone(m);
    const a = stopFlows(declare(m, { scenario: "orders-failover", step: 3 }).model);
    expect(m).toEqual(copy);
    expect(stopFlows(declare(m, { scenario: "orders-failover", step: 3 }).model)).toEqual(a);
  });
});

describe("declare: callouts (R16)", () => {
  const m = (() => { const r = validate({ components: [{ id: "a" }, { id: "b" }], callouts: [{ at: "a", text: "standing" }], scenarios: [{ id: "s", steps: [{ set: { failed: "a" }, callouts: [{ at: "b", text: "step one" }] }, { restore: "a", callouts: [{ at: "a", text: "step two" }] }, { set: { degraded: "b" } }] }] }); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.model; })();
  it("shows the standing callouts plus the current step's, never an earlier step's, then a what-if's", () => {
    expect(declare(m).model.callouts.map((c) => c.text)).toEqual(["standing"]);
    expect(declare(m, { scenario: "s", step: 1 }).model.callouts.map((c) => c.text)).toEqual(["standing", "step one"]);
    expect(declare(m, { scenario: "s", step: 2 }).model.callouts.map((c) => c.text)).toEqual(["standing", "step two"]);
    expect(declare(m, { scenario: "s", step: 3 }).model.callouts.map((c) => c.text)).toEqual(["standing"]);
    expect(declare(m, { scenario: "s", step: 1, callouts: [{ at: "a", text: "what if" }] }).model.callouts.map((c) => c.text)).toEqual(["standing", "step one", "what if"]);
  });
});

describe("declare: states on connections (#60)", () => {
  const conn = (m: Model, id: string) => m.connections.find((c) => c.key === id)!;
  it("a connection has a base state, the default unless the author wrote one", () => {
    const m = fixture("connection-states");
    expect(conn(m, "api-to-db").state).toBe("on");
    expect(conn(m, "api-to-cache").state).toBe("degraded");
    expect(conn(m, "db->cache").state).toBe("on");
  });
  it("a step sets a connection by id with its reason, and restore returns it to its base state (B2)", () => {
    const m = fixture("connection-states");
    const s1 = at(m, "cert-expires", 1).model;
    expect(conn(s1, "api-to-db")).toMatchObject({ state: "failed", reason: "TLS certificate expired" });
    expect(st(s1, "api")).toBe("degraded");
    expect(st(s1, "db"), "both ends keep the state the author gave them (B3)").toBe("on");
    const s2 = at(m, "cert-expires", 2).model;
    expect(conn(s2, "api-to-db").state).toBe("on");
    expect(conn(s2, "api-to-db").reason).toBeUndefined();
    expect(conn(s2, "api-to-cache").state, "restore is to the base state, not the default").toBe("degraded");
    expect(conn(m, "api-to-db").state, "the input is untouched (B1)").toBe("on");
  });
  it("a what-if names a connection like an entity; an unknown id throws", () => {
    const m = fixture("connection-states");
    const d = declare(m, { set: { brownout: ["web-to-api"] }, reasons: { "web-to-api": "rate limited" } }).model;
    expect(conn(d, "web-to-api")).toMatchObject({ state: "brownout", reason: "rate limited" });
    expect(() => applySet(m, { failed: ["db->cache"] })).toThrow(/unknown entity or connection id "db->cache"/);
  });
  it("a connection in a state that stops flows is drawn with load 0, whatever its load; its neighbours keep theirs (B4)", () => {
    const m = fixture("connection-states");
    const d = stopFlows(at(m, "cert-expires", 1).model);
    expect(load(d, "api-to-db")).toBe(0);
    expect(load(d, "web-to-api")).toBe(0.8);
    expect(load(d, "api-to-cache"), "degraded keeps flow").toBe(0.3);
    expect(load(stopFlows(declare(m, { set: { brownout: ["web-to-api"] } }).model), "web-to-api")).toBe(0);
  });
});
