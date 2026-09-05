import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeLayoutEngine, render, scopeModel, selectView, validate, type Model } from "../src/index.js";

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
