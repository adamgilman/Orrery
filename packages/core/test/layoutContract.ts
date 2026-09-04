import { describe, expect, it } from "vitest";
import type { LayoutEngine, LayoutGraph } from "../src/index.js";

/** Contract every LayoutEngine implementation must satisfy. Import and call from the engine's own test file. */
export function layoutContract(name: string, make: () => LayoutEngine) {
  const chain: LayoutGraph = {
    direction: "right",
    nodes: [
      { id: "web", width: 120, height: 48 },
      { id: "api", width: 140, height: 48 },
      { id: "db", width: 100, height: 48 },
    ],
    edges: [
      { id: "e0", from: "web", to: "api" },
      { id: "e1", from: "api", to: "db" },
    ],
  };
  const fan: LayoutGraph = {
    direction: "down",
    nodes: ["lb", "s1", "s2", "s3", "cache"].map((id) => ({ id, width: 120, height: 48 })),
    edges: [
      { id: "e0", from: "lb", to: "s1" }, { id: "e1", from: "lb", to: "s2" }, { id: "e2", from: "lb", to: "s3" },
      { id: "e3", from: "s1", to: "cache" }, { id: "e4", from: "s2", to: "cache" }, { id: "e5", from: "s3", to: "cache" },
    ],
  };

  describe(`LayoutEngine contract: ${name}`, () => {
    for (const [label, graph] of [["chain", chain], ["fan", fan]] as const) {
      it(`${label}: positions every node with its requested size`, async () => {
        const r = await make().layout(graph);
        for (const n of graph.nodes) {
          const p = r.nodes[n.id];
          expect(p, n.id).toBeDefined();
          expect(p!.width).toBe(n.width);
          expect(p!.height).toBe(n.height);
          expect(p!.x).toBeGreaterThanOrEqual(0);
          expect(p!.y).toBeGreaterThanOrEqual(0);
        }
      });

      it(`${label}: nodes do not overlap`, async () => {
        const r = await make().layout(graph);
        const boxes = Object.values(r.nodes);
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i]!, b = boxes[j]!;
            const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
            expect(overlap, `boxes ${i} and ${j} overlap`).toBe(false);
          }
      });

      it(`${label}: routes every edge from source boundary to target boundary`, async () => {
        const r = await make().layout(graph);
        for (const e of graph.edges) {
          const route = r.edges[e.id];
          expect(route, e.id).toBeDefined();
          expect(route!.points.length).toBeGreaterThanOrEqual(2);
          const onBoundary = (p: { x: number; y: number }, b: { x: number; y: number; width: number; height: number }) => {
            const eps = 1;
            const withinX = p.x >= b.x - eps && p.x <= b.x + b.width + eps;
            const withinY = p.y >= b.y - eps && p.y <= b.y + b.height + eps;
            const onV = Math.abs(p.x - b.x) <= eps || Math.abs(p.x - (b.x + b.width)) <= eps;
            const onH = Math.abs(p.y - b.y) <= eps || Math.abs(p.y - (b.y + b.height)) <= eps;
            return withinX && withinY && (onV || onH);
          };
          expect(onBoundary(route!.points[0]!, r.nodes[e.from]!), `${e.id} start`).toBe(true);
          expect(onBoundary(route!.points.at(-1)!, r.nodes[e.to]!), `${e.id} end`).toBe(true);
        }
      });

      it(`${label}: canvas contains every node`, async () => {
        const r = await make().layout(graph);
        for (const b of Object.values(r.nodes)) {
          expect(b.x + b.width).toBeLessThanOrEqual(r.width);
          expect(b.y + b.height).toBeLessThanOrEqual(r.height);
        }
      });

      it(`${label}: is deterministic`, async () => {
        const a = await make().layout(graph);
        const b = await make().layout(graph);
        expect(a).toEqual(b);
      });
    }

    it("places edge labels inside the canvas and clear of every node when sizes are given", async () => {
      const labelled: LayoutGraph = {
        ...fan,
        edges: fan.edges.map((e) => ({ ...e, label: { width: 70, height: 16 } })),
      };
      const r = await make().layout(labelled);
      for (const e of labelled.edges) {
        const at = r.edges[e.id]!.labelAt;
        expect(at, `${e.id} labelAt`).toBeDefined();
        const box = { x: at!.x - 35, y: at!.y - 8, width: 70, height: 16 };
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(r.width);
        expect(box.y + box.height).toBeLessThanOrEqual(r.height);
        for (const [id, n] of Object.entries(r.nodes)) {
          const overlap = box.x < n.x + n.width && n.x < box.x + box.width && box.y < n.y + n.height && n.y < box.y + box.height;
          expect(overlap, `${e.id} label overlaps node ${id}`).toBe(false);
        }
      }
    });

    it("respects direction: chain flows left to right", async () => {
      const r = await make().layout(chain);
      expect(r.nodes.web!.x).toBeLessThan(r.nodes.api!.x);
      expect(r.nodes.api!.x).toBeLessThan(r.nodes.db!.x);
    });

    it("respects direction: fan flows top to bottom", async () => {
      const r = await make().layout(fan);
      expect(r.nodes.lb!.y).toBeLessThan(r.nodes.s1!.y);
      expect(r.nodes.s2!.y).toBeLessThan(r.nodes.cache!.y);
    });
  });
}
