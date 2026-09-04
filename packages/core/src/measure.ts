import type { LayoutGraph } from "./layout.js";
import type { Diagram, DiagramNode } from "./types.js";

export const NODE_HEIGHT = 48;
export const NODE_MIN_WIDTH = 80;
const CHAR_WIDTH = 7.6; // average glyph width at 14px in a system sans font
const PADDING = 32;

/** Estimate a node's box from its label. Layout engines receive sizes; they never measure text. */
export function measureNode(node: DiagramNode): { width: number; height: number } {
  const width = Math.max(NODE_MIN_WIDTH, Math.ceil(node.label.length * CHAR_WIDTH + PADDING));
  return { width, height: NODE_HEIGHT };
}

const LABEL_CHAR_WIDTH = 6.6; // 12px font
export const EDGE_LABEL_HEIGHT = 16;

/** Estimate an edge label's box so the layout engine can reserve room for it. */
export function measureEdgeLabel(text: string): { width: number; height: number } {
  return { width: Math.ceil(text.length * LABEL_CHAR_WIDTH + 8), height: EDGE_LABEL_HEIGHT };
}

export const edgeId = (edge: { from: string; to: string }, index: number) => `e${index}`;

export function toLayoutGraph(diagram: Diagram): LayoutGraph {
  return {
    direction: diagram.direction,
    nodes: diagram.nodes.map((n) => ({ id: n.id, ...measureNode(n) })),
    edges: diagram.edges.map((e, i) => ({
      id: edgeId(e, i),
      from: e.from,
      to: e.to,
      ...(e.label !== undefined ? { label: measureEdgeLabel(e.label) } : {}),
    })),
  };
}
