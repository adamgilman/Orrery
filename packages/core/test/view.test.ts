import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeLayoutEngine, render, scopeDiagram, validate } from "../src/index.js";

const grouped = () => {
  const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid/grouped.json"), "utf8")));
  if (!r.ok) throw new Error();
  return r.diagram;
};

describe("scopeDiagram", () => {
  it("returns everything for a view without scope, with the view's direction and title", () => {
    const d = grouped();
    const s = scopeDiagram(d, d.views[0]!);
    expect(s.nodes.map((n) => n.id)).toEqual(["web", "api", "db", "replica"]);
    expect(s.groups.map((g) => g.id)).toEqual(["region", "app", "data"]);
    expect(s.direction).toBe("right");
    expect(s.title).toBe("Grouped three tier");
  });
  it("drills into a group: keeps the scope frame, its descendants, and edges among them", () => {
    const d = grouped();
    const s = scopeDiagram(d, d.views[1]!);
    expect(s.nodes.map((n) => n.id)).toEqual(["db", "replica"]);
    expect(s.groups).toEqual([{ id: "data", label: "Data", kind: "tier" }]); // parent dropped: it is now the root frame
    expect(s.edges.map((e) => e.id)).toEqual(["db->replica"]);
    expect(s.direction).toBe("down");
    expect(s.title).toBe("Data tier");
  });
  it("keeps nested descendants of the scope", () => {
    const d = grouped();
    const s = scopeDiagram(d, { id: "r", type: "topology", direction: "right", scope: "region" });
    expect(s.groups.map((g) => g.id)).toEqual(["region", "app", "data"]);
    expect(s.groups.find((g) => g.id === "region")?.parent).toBeUndefined();
    expect(s.groups.find((g) => g.id === "app")?.parent).toBe("region");
    expect(s.nodes.map((n) => n.id)).toEqual(["api", "db", "replica"]);
    expect(s.edges.map((e) => e.id)).toEqual(["api->db", "api-reads", "db->replica"]);
  });
});

describe("render with a view", () => {
  it("renders the named view only", async () => {
    const svg = await render(grouped(), new FakeLayoutEngine(), { view: "data-tier" });
    expect(svg).toContain('data-node="db"');
    expect(svg).not.toContain('data-node="web"');
    expect(svg).toContain("<title>Data tier</title>");
  });
  it("defaults to the first view", async () => {
    const svg = await render(grouped(), new FakeLayoutEngine());
    expect(svg).toContain('data-node="web"');
  });
  it("rejects an unknown view id, naming the available ones", async () => {
    await expect(render(grouped(), new FakeLayoutEngine(), { view: "nope" })).rejects.toThrow(/unknown view "nope".*overview, data-tier/);
  });
});
