import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeLayoutEngine, applySet, render, scopeModel, selectView, validate, type Model } from "../src/index.js";

const fixture = (name: string): Model => { const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid", `${name}.json`), "utf8"))); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.model; };
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("scopeModel", () => {
  it("without scope returns everything in the view's direction and title", () => {
    const m = fixture("grouped");
    const s = scopeModel(m, m.views[0]!);
    expect(ids(s.components)).toEqual(["web", "api", "db", "replica"]);
    expect(ids(s.groups)).toEqual(["region", "app", "data"]);
    expect(s.title).toBe("Grouped three tier");
  });
  it("scope keeps the group as root frame, its descendants, inside connections, and ghosts for one-ended ones (R4)", () => {
    const m = fixture("grouped");
    const s = scopeModel(m, m.views[1]!);
    expect(ids(s.groups)).toEqual(["data"]);
    expect(s.groups[0]!.parent).toBeUndefined();
    expect(ids(s.components)).toEqual(["db", "replica", "api"]);
    const api = s.components.find((c) => c.id === "api")!;
    expect(api.ghost).toBe(true);
    expect(api.group).toBeUndefined();
    expect(s.connections.map((c) => c.key)).toEqual(["api->db", "api-reads", "db->replica"]);
    expect(s.direction).toBe("down");
    expect(s.title).toBe("Data tier");
  });
  it("only restricts to listed entities, expanding a group to its descendants, and keeps containing groups", () => {
    const m = fixture("own-vocabulary");
    const s = scopeModel(m, m.views.find((v) => v.id === "matching")!);
    expect(ids(s.components.filter((c) => !c.ghost))).toEqual(["edge", "match-a", "match-b", "seq-1", "seq-2", "seq-3"]);
    expect(ids(s.groups)).toEqual(["eu", "cell-a", "cell-b", "consensus"]);
    expect(ids(s.components.filter((c) => c.ghost))).toEqual(["settlement"]);
    expect(s.groups.find((g) => g.id === "settlement")).toBeUndefined();
    expect(s.components.find((c) => c.id === "settlement")?.ghost).toBe(true);
  });
  it("scope and only intersect", () => {
    const m = fixture("own-vocabulary");
    const s = scopeModel(m, { id: "x", type: "topology", direction: "right", scope: "eu", only: ["cell-a"] });
    expect(ids(s.components.filter((c) => !c.ghost))).toEqual(["match-a"]);
    expect(ids(s.components.filter((c) => c.ghost))).toEqual(["edge", "consensus", "settlement"]); // every outside end, ghosted
    expect(ids(s.groups)).toEqual(["eu", "cell-a"]);
  });
  it("selectView picks by id or first and names the available ones on a miss", () => {
    const m = fixture("grouped");
    expect(selectView(m).id).toBe("overview");
    expect(selectView(m, "data-tier").id).toBe("data-tier");
    expect(() => selectView(m, "nope")).toThrow(/unknown view "nope".*overview, data-tier/);
  });
});

describe("render with a view", () => {
  it("renders the named view, with ghosts marked", async () => {
    const svg = await render(fixture("grouped"), new FakeLayoutEngine(), { view: "data-tier" });
    expect(svg).toContain('data-node="db"');
    expect(svg).toContain('data-node="api" data-kind="service" data-state="on" data-ghost="1"');
    expect(svg).not.toContain('data-node="web"');
    expect(svg).toContain("<title>Data tier</title>");
  });
});

describe("scopeModel: collapsed groups (R11)", () => {
  const m = () => fixture("drill-down");
  it("a closed group hides what is inside and takes over its connections; the count of hidden components is kept", () => {
    const s = scopeModel(m(), m().views[0]!);
    expect(s.components.map((c) => c.id)).toEqual(["web", "checkout", "catalog", "stripe", "adyen"]);
    expect(s.groups.map((g) => g.id)).toEqual(["storefront", "payments", "identity"]); // pay-core is inside payments
    expect(s.groups.find((g) => g.id === "payments")!.collapsed).toBe(4); // pay-api, ledger, ledger-replica, tokens
    expect(s.groups.find((g) => g.id === "identity")!.collapsed).toBe(2);
    // connections to hidden members re-attach to the closed box; internal ones vanish; several onto one pair merge
    const keys = s.connections.map((c) => `${c.from}->${c.to}`);
    expect(keys).toEqual(["web->checkout", "web->catalog", "checkout->payments", "checkout->identity", "payments->stripe", "payments->adyen"]);
    const charge = s.connections.find((c) => c.to === "payments")!;
    expect(charge.key).toBe("checkout->pay-api"); // keeps the key of the connection it stands for
    expect(charge.label).toBe("charge");
  });
  it("opening a group brings its members back; an inner closed group stays closed until opened too (any depth)", () => {
    const n = fixture("nested-drill");
    const closed = scopeModel(n, n.views[0]!);
    expect(closed.components.map((c) => c.id)).toEqual(["app"]);
    expect(closed.groups.map((g) => g.id)).toEqual(["outer"]);
    expect(closed.connections.map((c) => `${c.from}->${c.to}`)).toEqual(["app->outer"]); // x->y is internal to outer
    const outer = scopeModel(n, n.views[0]!, ["outer"]);
    expect(outer.components.map((c) => c.id)).toEqual(["app", "y"]);
    expect(outer.groups.map((g) => ({ id: g.id, collapsed: g.collapsed }))).toEqual([{ id: "outer", collapsed: undefined }, { id: "inner", collapsed: 1 }]);
    expect(outer.connections.map((c) => `${c.from}->${c.to}`)).toEqual(["app->outer", "inner->y"]);
    const both = scopeModel(n, n.views[0]!, ["outer", "inner"]);
    expect(both.components.map((c) => c.id)).toEqual(["app", "x", "y"]);
    expect(both.connections.map((c) => `${c.from}->${c.to}`)).toEqual(["app->outer", "x->y"]);
  });
  it("merged connections sum their load, capped at one, and a closed group keeps the state the author gave it", () => {
    const r = validate({ groups: [{ id: "g" }], components: [{ id: "a" }, { id: "p", group: "g" }, { id: "q", group: "g" }], connections: [{ from: "a", to: "p", load: 0.7 }, { from: "a", to: "q", load: 0.6 }], views: [{ id: "v", collapse: ["g"] }] });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const s = scopeModel(r.model, r.model.views[0]!);
    expect(s.connections).toHaveLength(1);
    expect(s.connections[0]!.load).toBe(1);
    const set = applySet(m(), { failed: ["ledger"], degraded: ["payments"] });
    const t = scopeModel(set, set.views[0]!);
    expect(t.groups.find((g) => g.id === "payments")!.state).toBe("degraded");
    expect(t.components.find((c) => c.id === "checkout")!.state).toBe("on");
  });
});


describe("scopeModel: callouts (R16)", () => {
  it("re-points a callout inside a closed group at the box, and drops one whose target is not drawn", () => {
    const r = validate({ groups: [{ id: "g" }, { id: "h" }], components: [{ id: "a", group: "g" }, { id: "b", group: "h" }, { id: "c" }], connections: [{ id: "ab", from: "a", to: "b" }, { id: "aa", from: "a", to: "c" }], callouts: [{ at: "a", text: "inside" }, { at: "b", text: "outside" }, { at: "ab", text: "line" }, { at: "c", text: "plain" }], views: [{ id: "v", only: ["g", "c"], collapse: ["g"] }] });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const scoped = scopeModel(r.model, r.model.views[0]!);
    expect(scoped.callouts).toEqual([{ at: "g", text: "inside" }, { at: "ab", text: "line" }, { at: "c", text: "plain" }]); // the line survives, to a ghost
    expect(scopeModel(r.model, r.model.views[0]!, ["g"]).callouts.map((c) => c.at)).toEqual(["a", "ab", "c"]);
  });
});
