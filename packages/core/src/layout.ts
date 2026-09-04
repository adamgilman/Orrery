import type { Direction } from "./types.js";

/** Orrery's own layout types. No engine-specific types cross this boundary. */
export interface LayoutGraph {
  direction: Direction;
  /** Containers. `labelHeight` is the band reserved at the top of the frame for its title. */
  groups?: { id: string; parent?: string; labelHeight: number }[];
  nodes: { id: string; width: number; height: number; group?: string }[];
  edges: { id: string; from: string; to: string; label?: { width: number; height: number } }[];
}

export interface Point { x: number; y: number }
export interface Box { x: number; y: number; width: number; height: number }

export interface LayoutResult {
  width: number;
  height: number;
  nodes: Record<string, Box>;
  /** Frame per group id, absolute coordinates. Contains all member nodes and child groups with padding. */
  groups: Record<string, Box>;
  /** Polyline route per edge id, from source boundary to target boundary. `labelAt` is the label's centre when the graph supplied a label size. */
  edges: Record<string, { points: Point[]; labelAt?: Point }>;
}

export interface LayoutEngine {
  /** Must be deterministic: identical graph in, identical result out. */
  layout(graph: LayoutGraph): Promise<LayoutResult>;
}

const MARGIN = 20;
const GAP = 80;
/** Inset between a group frame and its contents, on every side except the top, which adds the label band. */
export const GROUP_PADDING = 12;

/**
 * Places nodes in a single row (direction "right") or column ("down") with straight edges between facing
 * boundaries. Nodes are ordered so each group's members are contiguous; group frames are the padded union of
 * their contents, so nesting and sibling separation hold. Used by tests so renderer tests never depend on ELK.
 */
export class FakeLayoutEngine implements LayoutEngine {
  async layout(graph: LayoutGraph): Promise<LayoutResult> {
    const groups = graph.groups ?? [];
    const parentOf = new Map(groups.map((g) => [g.id, g.parent] as const));
    const depthOf = (id: string | undefined): number => (id === undefined ? 0 : 1 + depthOf(parentOf.get(id)));
    const path = (id: string | undefined): string => (id === undefined ? "" : `${path(parentOf.get(id))}/${id}`);
    // Stable sort by group path: members of a group (and its subgroups) end up adjacent.
    const ordered = graph.nodes.map((n, i) => ({ n, i })).sort((a, b) => path(a.n.group).localeCompare(path(b.n.group)) || a.i - b.i).map((x) => x.n);
    const horizontal = graph.direction === "right";
    const maxDepth = groups.reduce((m, g) => Math.max(m, depthOf(g.id)), 0);
    const outer = MARGIN + maxDepth * (GROUP_PADDING + 20);

    const nodes: Record<string, Box> = {};
    let cursor = outer;
    let cross = 0;
    let prevGroup: string | undefined;
    for (const n of ordered) {
      // Extra gap when crossing a group boundary so frames plus padding fit between neighbours.
      if (cursor !== outer && n.group !== prevGroup) cursor += 2 * (GROUP_PADDING + 8) * (maxDepth || 1);
      nodes[n.id] = horizontal
        ? { x: cursor, y: outer, width: n.width, height: n.height }
        : { x: outer, y: cursor, width: n.width, height: n.height };
      cursor += (horizontal ? n.width : n.height) + GAP;
      cross = Math.max(cross, horizontal ? n.height : n.width);
      prevGroup = n.group;
    }

    // Group frames: union of member nodes and child groups, padded; deepest first so parents see children.
    const boxes: Record<string, Box> = {};
    const byDepth = [...groups].sort((a, b) => depthOf(b.id) - depthOf(a.id));
    for (const g of byDepth) {
      const members = [
        ...graph.nodes.filter((n) => n.group === g.id).map((n) => nodes[n.id]!),
        ...groups.filter((c) => c.parent === g.id).map((c) => boxes[c.id]!),
      ];
      if (members.length === 0) { boxes[g.id] = { x: 0, y: 0, width: 2 * GROUP_PADDING, height: g.labelHeight + GROUP_PADDING }; continue; }
      const x0 = Math.min(...members.map((m) => m.x)) - GROUP_PADDING;
      const y0 = Math.min(...members.map((m) => m.y)) - GROUP_PADDING - g.labelHeight;
      const x1 = Math.max(...members.map((m) => m.x + m.width)) + GROUP_PADDING;
      const y1 = Math.max(...members.map((m) => m.y + m.height)) + GROUP_PADDING;
      boxes[g.id] = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    }

    const edges: LayoutResult["edges"] = {};
    for (const e of graph.edges) {
      const a = nodes[e.from]!, b = nodes[e.to]!;
      const forward = horizontal ? b.x >= a.x : b.y >= a.y;
      const points = horizontal
        ? forward
          ? [{ x: a.x + a.width, y: a.y + a.height / 2 }, { x: b.x, y: b.y + b.height / 2 }]
          : [{ x: a.x, y: a.y + a.height / 2 }, { x: b.x + b.width, y: b.y + b.height / 2 }]
        : forward
          ? [{ x: a.x + a.width / 2, y: a.y + a.height }, { x: b.x + b.width / 2, y: b.y }]
          : [{ x: a.x + a.width / 2, y: a.y }, { x: b.x + b.width / 2, y: b.y + b.height }];
      // Label sits in the gap right after the source, so it never lands on a node even when the edge skips past siblings.
      const labelAt = e.label
        ? horizontal
          ? { x: a.x + a.width + GAP / 2, y: a.y + a.height / 2 }
          : { x: a.x + a.width / 2, y: a.y + a.height + GAP / 2 }
        : undefined;
      edges[e.id] = labelAt ? { points, labelAt } : { points };
    }
    const all = [...Object.values(nodes), ...Object.values(boxes)];
    const width = Math.max(...all.map((b) => b.x + b.width)) + MARGIN;
    const height = Math.max(...all.map((b) => b.y + b.height)) + MARGIN;
    return { width, height, nodes, groups: boxes, edges };
  }
}
