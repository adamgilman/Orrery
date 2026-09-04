import type { Direction } from "./types.js";

/** Orrery's own layout types. No engine-specific types cross this boundary. */
export interface LayoutGraph {
  direction: Direction;
  nodes: { id: string; width: number; height: number }[];
  edges: { id: string; from: string; to: string; label?: { width: number; height: number } }[];
}

export interface Point { x: number; y: number }
export interface Box { x: number; y: number; width: number; height: number }

export interface LayoutResult {
  width: number;
  height: number;
  nodes: Record<string, Box>;
  /** Polyline route per edge id, from source boundary to target boundary. `labelAt` is the label's centre when the graph supplied a label size. */
  edges: Record<string, { points: Point[]; labelAt?: Point }>;
}

export interface LayoutEngine {
  /** Must be deterministic: identical graph in, identical result out. */
  layout(graph: LayoutGraph): Promise<LayoutResult>;
}

const MARGIN = 20;
const GAP = 80;

/**
 * Places nodes in a single row (direction "right") or column ("down"), in input order,
 * with straight edges between facing boundaries. Used by tests so renderer tests never depend on ELK.
 */
export class FakeLayoutEngine implements LayoutEngine {
  async layout(graph: LayoutGraph): Promise<LayoutResult> {
    const nodes: Record<string, Box> = {};
    const horizontal = graph.direction === "right";
    let cursor = MARGIN;
    let cross = 0;
    for (const n of graph.nodes) {
      nodes[n.id] = horizontal
        ? { x: cursor, y: MARGIN, width: n.width, height: n.height }
        : { x: MARGIN, y: cursor, width: n.width, height: n.height };
      cursor += (horizontal ? n.width : n.height) + GAP;
      cross = Math.max(cross, horizontal ? n.height : n.width);
    }
    const main = cursor - GAP + MARGIN;
    const edges: LayoutResult["edges"] = {};
    for (const e of graph.edges) {
      const a = nodes[e.from]!, b = nodes[e.to]!;
      const points = horizontal
        ? [{ x: a.x + a.width, y: a.y + a.height / 2 }, { x: b.x, y: b.y + b.height / 2 }]
        : [{ x: a.x + a.width / 2, y: a.y + a.height }, { x: b.x + b.width / 2, y: b.y }];
      // Label sits in the gap right after the source, so it never lands on a node even when the edge skips past siblings.
      const labelAt = e.label
        ? horizontal
          ? { x: a.x + a.width + GAP / 2, y: a.y + a.height / 2 }
          : { x: a.x + a.width / 2, y: a.y + a.height + GAP / 2 }
        : undefined;
      edges[e.id] = labelAt ? { points, labelAt } : { points };
    }
    return {
      width: horizontal ? main : cross + 2 * MARGIN,
      height: horizontal ? cross + 2 * MARGIN : main,
      nodes,
      edges,
    };
  }
}
