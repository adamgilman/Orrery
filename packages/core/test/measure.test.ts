import { describe, expect, it } from "vitest";
import { GROUP_LABEL_HEIGHT, measureEdgeLabel, measureNode, toLayoutGraph, validate } from "../src/index.js";

describe("measureNode", () => {
  it("grows width with label length and keeps a minimum", () => {
    const short = measureNode({ id: "a", label: "DB" });
    const long = measureNode({ id: "b", label: "Recommendation service" });
    expect(long.width).toBeGreaterThan(short.width);
    expect(short.width).toBeGreaterThanOrEqual(80);
    expect(short.height).toBe(long.height);
  });
});

describe("toLayoutGraph", () => {
  it("maps nodes with sizes and edges with stable ids", () => {
    const r = validate({ direction: "down", nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }] });
    if (!r.ok) throw new Error("fixture invalid");
    const g = toLayoutGraph(r.diagram);
    expect(g.direction).toBe("down");
    expect(g.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(g.nodes[0]!.width).toBeGreaterThan(0);
    expect(g.edges).toEqual([{ id: "a->b", from: "a", to: "b" }]);
  });

  it("carries groups with parents and label bands, and node membership", () => {
    const r = validate({
      groups: [{ id: "r", label: "Region" }, { id: "t", parent: "r" }],
      nodes: [{ id: "a", group: "t" }, { id: "b" }],
      edges: [],
    });
    if (!r.ok) throw new Error("fixture invalid");
    const g = toLayoutGraph(r.diagram);
    expect(g.groups).toEqual([{ id: "r", labelHeight: GROUP_LABEL_HEIGHT }, { id: "t", parent: "r", labelHeight: GROUP_LABEL_HEIGHT }]);
    expect(g.nodes.find((n) => n.id === "a")?.group).toBe("t");
    expect(g.nodes.find((n) => n.id === "b")?.group).toBeUndefined();
  });

  it("measures edge labels so the layout engine can place them", () => {
    const r = validate({ nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b", label: "replication" }] });
    if (!r.ok) throw new Error("fixture invalid");
    const e = toLayoutGraph(r.diagram).edges[0]!;
    expect(e.label?.height).toBeGreaterThan(0);
    expect(e.label!.width).toBeGreaterThan(measureEdgeLabel("ok").width);
  });
});
