import { describe, expect, it } from "vitest";
import { GROUP_LABEL_HEIGHT, measureComponent, measureConnectionLabel, toLayoutGraph, validate } from "../src/index.js";

const model = (input: unknown) => { const r = validate(input); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.model; };

describe("measureComponent", () => {
  it("grows width with label, glyph and replicas badge; grows height with a tech line", () => {
    const L = "Orders database";
    const m = model({ components: [{ id: "a", label: L }, { id: "b", label: "Recommendation service cluster" }, { id: "c", label: L, kind: "database" }, { id: "d", label: L, tech: "PostgreSQL 16" }, { id: "e", label: L, replicas: 3 }] });
    const [a, b, c, d, e] = m.components.map((x) => measureComponent(x, m));
    expect(b!.width).toBeGreaterThan(a!.width);
    expect(c!.width).toBeGreaterThan(a!.width); // glyph
    expect(d!.height).toBeGreaterThan(a!.height); // tech line
    expect(e!.width).toBeGreaterThan(a!.width); // ×3 badge
    expect(a!.width).toBeGreaterThanOrEqual(80);
  });
});

describe("toLayoutGraph", () => {
  it("maps components, groups (with membership) and connections keyed by connection key", () => {
    const m = model({ direction: "down", groups: [{ id: "r" }, { id: "t", parent: "r" }], components: [{ id: "a", group: "t" }, { id: "b" }], connections: [{ from: "a", to: "b", label: "x" }, { from: "b", to: "r" }] });
    const g = toLayoutGraph(m);
    expect(g.direction).toBe("down");
    expect(g.groups).toEqual([{ id: "r", labelHeight: GROUP_LABEL_HEIGHT }, { id: "t", parent: "r", labelHeight: GROUP_LABEL_HEIGHT }]);
    expect(g.nodes.map((n) => [n.id, n.group])).toEqual([["a", "t"], ["b", undefined]]);
    expect(g.edges.map((e) => e.id)).toEqual(["a->b", "b->r"]);
    expect(g.edges[0]!.label!.width).toBeGreaterThan(measureConnectionLabel("").width);
  });
});
