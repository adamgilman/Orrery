import { describe, expect, it } from "vitest";
import { GROUP_PADDING, type LayoutEngine, type LayoutGraph } from "../src/index.js";

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

  /** region > { app > {api}, data > {db, replica} }, web outside everything. */
  const grouped: LayoutGraph = {
    direction: "right",
    groups: [
      { id: "region", labelHeight: 20 },
      { id: "app", parent: "region", labelHeight: 20 },
      { id: "data", parent: "region", labelHeight: 20 },
    ],
    nodes: [
      { id: "web", width: 120, height: 48 },
      { id: "api", width: 140, height: 48, group: "app" },
      { id: "db", width: 100, height: 48, group: "data" },
      { id: "replica", width: 120, height: 48, group: "data" },
    ],
    edges: [
      { id: "e0", from: "web", to: "api" },
      { id: "e1", from: "api", to: "db" },
      { id: "e2", from: "api", to: "replica" },
      { id: "e3", from: "db", to: "replica" },
    ],
  };
  const inside = (inner: { x: number; y: number; width: number; height: number }, outer: { x: number; y: number; width: number; height: number }, margin = 0) =>
    inner.x >= outer.x + margin && inner.y >= outer.y + margin && inner.x + inner.width <= outer.x + outer.width - margin && inner.y + inner.height <= outer.y + outer.height - margin;

  /** Connections whose ends are groups, including an empty one (S13, R7). */
  const groupEnds: LayoutGraph = {
    direction: "right",
    groups: [
      { id: "platform", labelHeight: 20 },
      { id: "empty", labelHeight: 20 },
    ],
    nodes: [
      { id: "edge", width: 120, height: 48 },
      { id: "svc", width: 120, height: 48, group: "platform" },
    ],
    edges: [
      { id: "e0", from: "edge", to: "platform" },
      { id: "e1", from: "edge", to: "empty" },
    ],
  };

  describe(`LayoutEngine contract: ${name} (group endpoints)`, () => {
    it("gives an empty group a box of minimum size that overlaps nothing", async () => {
      const r = await make().layout(groupEnds);
      const e = r.groups.empty!;
      expect(e.width).toBeGreaterThanOrEqual(80);
      expect(e.height).toBeGreaterThanOrEqual(40);
      const boxes = [...Object.values(r.nodes), r.groups.platform!];
      for (const b of boxes) {
        const overlap = e.x < b.x + b.width && b.x < e.x + e.width && e.y < b.y + b.height && b.y < e.y + e.height;
        expect(overlap).toBe(false);
      }
    });
    it("routes edges to a group's frame boundary", async () => {
      const r = await make().layout(groupEnds);
      const onBoundary = (p: { x: number; y: number }, b: { x: number; y: number; width: number; height: number }) => {
        const eps = 1.5;
        const withinX = p.x >= b.x - eps && p.x <= b.x + b.width + eps, withinY = p.y >= b.y - eps && p.y <= b.y + b.height + eps;
        const onV = Math.abs(p.x - b.x) <= eps || Math.abs(p.x - (b.x + b.width)) <= eps, onH = Math.abs(p.y - b.y) <= eps || Math.abs(p.y - (b.y + b.height)) <= eps;
        return withinX && withinY && (onV || onH);
      };
      expect(onBoundary(r.edges.e0!.points.at(-1)!, r.groups.platform!)).toBe(true);
      expect(onBoundary(r.edges.e1!.points.at(-1)!, r.groups.empty!)).toBe(true);
      expect(onBoundary(r.edges.e0!.points[0]!, r.nodes.edge!)).toBe(true);
    });
  });

  describe(`LayoutEngine contract: ${name} (groups)`, () => {
    it("returns a box for every group", async () => {
      const r = await make().layout(grouped);
      for (const g of grouped.groups!) expect(r.groups[g.id], g.id).toBeDefined();
    });
    it("keeps every node strictly inside its group with padding, below the label band", async () => {
      const r = await make().layout(grouped);
      for (const n of grouped.nodes) {
        if (!n.group) continue;
        const g = r.groups[n.group]!, b = r.nodes[n.id]!;
        expect(inside(b, g, 8), `${n.id} in ${n.group}`).toBe(true);
        expect(b.y, `${n.id} below label of ${n.group}`).toBeGreaterThanOrEqual(g.y + 20);
      }
    });
    it("adds a group's pad to its padding on every side, and to a closed group's size", async () => {
      const padded: LayoutGraph = { direction: "right", groups: [{ id: "g", labelHeight: 20, pad: { x: 30, y: 10 } }, { id: "c", labelHeight: 20, pad: { x: 30, y: 10 }, emptySize: { width: 160, height: 72 } }], nodes: [{ id: "a", width: 100, height: 48, group: "g" }, { id: "b", width: 100, height: 48 }], edges: [{ id: "e", from: "a", to: "c" }] };
      const r = await make().layout(padded);
      const g = r.groups.g!, a = r.nodes.a!;
      expect(a.x - g.x).toBeGreaterThanOrEqual(GROUP_PADDING + 30 - 1);
      expect(g.x + g.width - (a.x + a.width)).toBeGreaterThanOrEqual(GROUP_PADDING + 30 - 1);
      expect(a.y - g.y).toBeGreaterThanOrEqual(GROUP_PADDING + 20 + 10 - 1);
      expect(g.y + g.height - (a.y + a.height)).toBeGreaterThanOrEqual(GROUP_PADDING + 10 - 1);
      expect(r.groups.c!.width).toBe(160); expect(r.groups.c!.height).toBe(72);
    });
    it("nests child groups strictly inside their parent", async () => {
      const r = await make().layout(grouped);
      for (const g of grouped.groups!) {
        if (!g.parent) continue;
        expect(inside(r.groups[g.id]!, r.groups[g.parent]!, 8), `${g.id} in ${g.parent}`).toBe(true);
        expect(r.groups[g.id]!.y).toBeGreaterThanOrEqual(r.groups[g.parent]!.y + 20);
      }
    });
    it("keeps sibling groups apart and ungrouped nodes outside every group", async () => {
      const r = await make().layout(grouped);
      const a = r.groups.app!, d = r.groups.data!;
      const overlap = a.x < d.x + d.width && d.x < a.x + a.width && a.y < d.y + d.height && d.y < a.y + a.height;
      expect(overlap).toBe(false);
      const web = r.nodes.web!;
      for (const [id, g] of Object.entries(r.groups)) {
        const o = web.x < g.x + g.width && g.x < web.x + web.width && web.y < g.y + g.height && g.y < web.y + web.height;
        expect(o, `web overlaps ${id}`).toBe(false);
      }
    });
    it("routes cross-group edges from boundary to boundary in absolute coordinates", async () => {
      const r = await make().layout(grouped);
      const e = r.edges.e0!;
      const web = r.nodes.web!, api = r.nodes.api!;
      const p0 = e.points[0]!, pn = e.points.at(-1)!;
      expect(Math.abs(p0.x - (web.x + web.width)) <= 1 || Math.abs(p0.y - web.y) <= 1 || Math.abs(p0.y - (web.y + web.height)) <= 1 || Math.abs(p0.x - web.x) <= 1).toBe(true);
      expect(pn.x >= api.x - 1 && pn.x <= api.x + api.width + 1 && pn.y >= api.y - 1 && pn.y <= api.y + api.height + 1).toBe(true);
    });
    it("canvas contains every group", async () => {
      const r = await make().layout(grouped);
      for (const g of Object.values(r.groups)) {
        expect(g.x).toBeGreaterThanOrEqual(0);
        expect(g.y).toBeGreaterThanOrEqual(0);
        expect(g.x + g.width).toBeLessThanOrEqual(r.width);
        expect(g.y + g.height).toBeLessThanOrEqual(r.height);
      }
    });
    it("is deterministic with groups", async () => {
      expect(await make().layout(grouped)).toEqual(await make().layout(grouped));
    });
  });

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
