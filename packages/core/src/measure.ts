import type { LayoutGraph } from "./layout.js";
import type { Diagram, DiagramNode } from "./types.js";

export const NODE_HEIGHT = 48;
/** Band reserved at the top of a group frame for its title. */
export const GROUP_LABEL_HEIGHT = 24;
export const NODE_MIN_WIDTH = 80;
const CHAR_WIDTH = 7.6; // average glyph width at 14px in a system sans font
const PADDING = 32;
/** Extra width for the kind glyph drawn left of the label. */
export const GLYPH_WIDTH = 24;
/** Kinds drawn with a glyph; "service" and "external" rely on box style alone. */
export const GLYPH_KINDS: ReadonlySet<string> = new Set(["database", "queue", "cache", "gateway", "client", "storage", "function"]);

/** Estimate a node's box from its label. Layout engines receive sizes; they never measure text. */
export function measureNode(node: DiagramNode): { width: number; height: number } {
  const glyph = GLYPH_KINDS.has(node.kind) ? GLYPH_WIDTH : 0;
  const width = Math.max(NODE_MIN_WIDTH, Math.ceil(node.label.length * CHAR_WIDTH + PADDING + glyph));
  return { width, height: NODE_HEIGHT };
}

const LABEL_CHAR_WIDTH = 6.6; // 12px font
export const EDGE_LABEL_HEIGHT = 16;

/** Estimate an edge label's box so the layout engine can reserve room for it. */
export function measureEdgeLabel(text: string): { width: number; height: number } {
  return { width: Math.ceil(text.length * LABEL_CHAR_WIDTH + 8), height: EDGE_LABEL_HEIGHT };
}

export function toLayoutGraph(diagram: Diagram): LayoutGraph {
  return {
    direction: diagram.direction,
    groups: diagram.groups.map((g) => ({ id: g.id, ...(g.parent !== undefined ? { parent: g.parent } : {}), labelHeight: GROUP_LABEL_HEIGHT })),
    nodes: diagram.nodes.map((n) => ({ id: n.id, ...measureNode(n), ...(n.group !== undefined ? { group: n.group } : {}) })),
    edges: diagram.edges.map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      ...(e.label !== undefined ? { label: measureEdgeLabel(e.label) } : {}),
    })),
  };
}
