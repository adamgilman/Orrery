import { describe, expect, it } from "vitest";
import { measureNode, toLayoutGraph, validate } from "../src/index.js";

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
    expect(g.edges).toEqual([{ id: "e0", from: "a", to: "b" }]);
  });
});
