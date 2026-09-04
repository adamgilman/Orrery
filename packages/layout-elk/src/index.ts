import ElkModule, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";

// elk.bundled.js is a CommonJS bundle exporting { default: ELK, Worker }. Node ESM hands us that object,
// while bundlers/vitest unwrap it to the constructor. Accept both shapes.
type ElkCtor = typeof ElkModule.default;
const ELK: ElkCtor = (ElkModule as { default?: ElkCtor }).default ?? (ElkModule as unknown as ElkCtor);
import type { LayoutEngine, LayoutGraph, LayoutResult } from "@orrery/core";

const PADDING = 20;

export interface ElkOptions {
  /** Distance between layers (ranks). */
  layerSpacing?: number;
  /** Distance between nodes in the same layer. */
  nodeSpacing?: number;
}

/** LayoutEngine backed by the Eclipse Layout Kernel (layered algorithm, orthogonal routing). */
export class ElkLayoutEngine implements LayoutEngine {
  private readonly elk = new ELK();
  constructor(private readonly options: ElkOptions = {}) {}

  async layout(graph: LayoutGraph): Promise<LayoutResult> {
    const { layerSpacing = 40, nodeSpacing = 40 } = this.options;
    const input: ElkNode = {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": graph.direction === "right" ? "RIGHT" : "DOWN",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.layered.spacing.nodeNodeBetweenLayers": String(layerSpacing),
        "elk.spacing.nodeNode": String(nodeSpacing),
        "elk.spacing.edgeNode": "25",
        "elk.spacing.edgeEdge": "15",
        "elk.layered.spacing.edgeNodeBetweenLayers": "25",
        "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
        // Input order is a signal from the author: keep siblings in JSON order so agents can predict the canvas.
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
        "elk.padding": `[top=${PADDING},left=${PADDING},bottom=${PADDING},right=${PADDING}]`,
        // Inline labels: ELK reserves room on the edge itself, so labels never collide with nodes or each other.
        "elk.edgeLabels.inline": "true",
      },
      children: graph.nodes.map((n) => ({ id: n.id, width: n.width, height: n.height })),
      edges: graph.edges.map((e): ElkExtendedEdge => ({
        id: e.id,
        sources: [e.from],
        targets: [e.to],
        ...(e.label ? { labels: [{ text: e.id, width: e.label.width, height: e.label.height }] } : {}),
      })),
    };
    const out = await this.elk.layout(input);
    const nodes: LayoutResult["nodes"] = {};
    for (const c of out.children ?? []) nodes[c.id] = { x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 0, height: c.height ?? 0 };
    const edges: LayoutResult["edges"] = {};
    for (const e of out.edges ?? []) {
      const s = e.sections?.[0];
      if (!s) throw new Error(`ELK returned no route for edge ${e.id}`);
      const points = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({ x: p.x, y: p.y }));
      const l = e.labels?.[0];
      edges[e.id] = l && l.x !== undefined && l.y !== undefined
        ? { points, labelAt: { x: l.x + (l.width ?? 0) / 2, y: l.y + (l.height ?? 0) / 2 } }
        : { points };
    }
    return { width: out.width ?? 0, height: out.height ?? 0, nodes, edges };
  }
}
