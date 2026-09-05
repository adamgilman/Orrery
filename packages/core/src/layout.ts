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

/** Box for a group with nothing inside: a black box. Shared by every engine. */
export const EMPTY_GROUP = { width: 120, height: 48 };

/** Groups with no member components and no child groups. */
export function emptyGroups(graph: LayoutGraph): Set<string> {
  const hasMembers = new Set<string>([...graph.nodes.map((n) => n.group), ...(graph.groups ?? []).map((g) => g.parent)].filter((x): x is string => x !== undefined));
  return new Set((graph.groups ?? []).filter((g) => !hasMembers.has(g.id)).map((g) => g.id));
}

/**
 * Places nodes (and empty groups, as boxes) in a single row (direction "right") or column ("down") with straight
 * edges between facing boundaries. Nodes are ordered so each group's members are contiguous; group frames are the
 * padded union of their contents. Edge ends may be groups. Used by tests so renderer tests never depend on ELK.
 */
export class FakeLayoutEngine implements LayoutEngine {
  async layout(graph: LayoutGraph): Promise<LayoutResult> {
    const groups = graph.groups ?? [];
    const parentOf = new Map(groups.map((g) => [g.id, g.parent] as const));
    const depthOf = (id: string | undefined): number => (id === undefined ? 0 : 1 + depthOf(parentOf.get(id)));
    const path = (id: string | undefined): string => (id === undefined ? "" : `${path(parentOf.get(id))}/${id}`);
    const empty = emptyGroups(graph);
    const empties = groups.filter((g) => empty.has(g.id));
    // Items placed in the row: real nodes plus empty groups as pseudo-nodes.
    const items = [
      ...graph.nodes.map((n, i) => ({ id: n.id, width: n.width, height: n.height, group: n.group, i, empty: false })),
      ...empties.map((g, i) => ({ id: g.id, width: EMPTY_GROUP.width, height: EMPTY_GROUP.height + g.labelHeight, group: g.parent, i: graph.nodes.length + i, empty: true })),
    ].sort((a, b) => { const pa = path(a.group), pb = path(b.group); return pa < pb ? -1 : pa > pb ? 1 : a.i - b.i; });
    const horizontal = graph.direction === "right";
    const maxDepth = groups.reduce((m, g) => Math.max(m, depthOf(g.id)), 0);
    const outer = MARGIN + maxDepth * (GROUP_PADDING + 20);

    const boxes: Record<string, Box> = {};
    let cursor = outer, cross = 0, prevGroup: string | undefined;
    for (const it of items) {
      if (cursor !== outer && it.group !== prevGroup) cursor += 2 * (GROUP_PADDING + 8) * (maxDepth || 1);
      boxes[it.id] = horizontal ? { x: cursor, y: outer, width: it.width, height: it.height } : { x: outer, y: cursor, width: it.width, height: it.height };
      cursor += (horizontal ? it.width : it.height) + GAP;
      cross = Math.max(cross, horizontal ? it.height : it.width);
      prevGroup = it.group;
    }
    const nodes: Record<string, Box> = Object.fromEntries(graph.nodes.map((n) => [n.id, boxes[n.id]!]));

    // Group frames: union of member nodes and child groups, padded; deepest first so parents see children.
    const groupBoxes: Record<string, Box> = {};
    for (const g of [...groups].sort((a, b) => depthOf(b.id) - depthOf(a.id))) {
      if (empty.has(g.id)) { groupBoxes[g.id] = boxes[g.id]!; continue; }
      const members = [
        ...graph.nodes.filter((n) => n.group === g.id).map((n) => nodes[n.id]!),
        ...groups.filter((c) => c.parent === g.id).map((c) => groupBoxes[c.id]!),
      ];
      const x0 = Math.min(...members.map((m) => m.x)) - GROUP_PADDING;
      const y0 = Math.min(...members.map((m) => m.y)) - GROUP_PADDING - g.labelHeight;
      const x1 = Math.max(...members.map((m) => m.x + m.width)) + GROUP_PADDING;
      const y1 = Math.max(...members.map((m) => m.y + m.height)) + GROUP_PADDING;
      groupBoxes[g.id] = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    }

    const edges: LayoutResult["edges"] = {};
    const boxOf = (id: string) => nodes[id] ?? groupBoxes[id]!;
    for (const e of graph.edges) {
      const a = boxOf(e.from), b = boxOf(e.to);
      const forward = horizontal ? b.x >= a.x : b.y >= a.y;
      const points = horizontal
        ? forward ? [{ x: a.x + a.width, y: a.y + a.height / 2 }, { x: b.x, y: b.y + b.height / 2 }] : [{ x: a.x, y: a.y + a.height / 2 }, { x: b.x + b.width, y: b.y + b.height / 2 }]
        : forward ? [{ x: a.x + a.width / 2, y: a.y + a.height }, { x: b.x + b.width / 2, y: b.y }] : [{ x: a.x + a.width / 2, y: a.y }, { x: b.x + b.width / 2, y: b.y + b.height }];
      const labelAt = e.label ? (horizontal ? { x: a.x + a.width + GAP / 2, y: a.y + a.height / 2 } : { x: a.x + a.width / 2, y: a.y + a.height + GAP / 2 }) : undefined;
      edges[e.id] = labelAt ? { points, labelAt } : { points };
    }
    const all = [...Object.values(nodes), ...Object.values(groupBoxes)];
    return { width: Math.max(...all.map((b) => b.x + b.width)) + MARGIN, height: Math.max(...all.map((b) => b.y + b.height)) + MARGIN, nodes, groups: groupBoxes, edges };
  }
}
