import ElkModule, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";

// elk.bundled.js is a CommonJS bundle exporting { default: ELK, Worker }. Node ESM hands us that object,
// while bundlers/vitest unwrap it to the constructor. Accept both shapes.
type ElkCtor = typeof ElkModule.default;
const ELK: ElkCtor = (ElkModule as { default?: ElkCtor }).default ?? (ElkModule as unknown as ElkCtor);
import { EMPTY_GROUP, GROUP_PADDING, emptyGroups, type LayoutEngine, type LayoutGraph, type LayoutResult } from "@orrery/core";

const PADDING = 20;

export interface ElkOptions {
  /** Distance between layers (ranks). */
  layerSpacing?: number;
  /** Distance between nodes in the same layer. */
  nodeSpacing?: number;
  /** Raw ELK options merged last. For tuning experiments; production defaults live in this file. */
  extra?: Record<string, string>;
}

/** LayoutEngine backed by the Eclipse Layout Kernel (layered algorithm, orthogonal routing). */
export class ElkLayoutEngine implements LayoutEngine {
  private readonly elk = new ELK();
  constructor(private readonly options: ElkOptions = {}) {}

  async layout(graph: LayoutGraph): Promise<LayoutResult> {
    const { layerSpacing = 40, nodeSpacing = 40, extra = {} } = this.options;
    const groups = graph.groups ?? [];
    const common = {
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
      "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
      // considerModelOrder=NODES_AND_EDGES crashes ELK 0.9 inside compound graphs (hierarchyHandling INCLUDE_CHILDREN),
      // so it is only enabled for flat graphs. ELK 0.12 crashes on compound graphs with forceNodeModelOrder too
      // ("Cannot read properties of undefined (reading 'a')"), so elkjs stays at 0.9 until a release fixes it.
      ...(groups.length === 0 ? { "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES" } : {}),
      // Inline labels: ELK reserves room on the edge itself, so labels never collide with nodes or each other.
      "elk.edgeLabels.inline": "true",
      ...extra,
    };
    // Build the compound-node tree: groups become ELK nodes with padding that reserves the label band.
    const elkNodes = new Map<string, ElkNode>();
    const empty = emptyGroups(graph);
    for (const g of groups) {
      elkNodes.set(g.id, {
        id: g.id,
        layoutOptions: { ...common, "elk.padding": `[top=${GROUP_PADDING + g.labelHeight + (g.pad?.y ?? 0)},left=${GROUP_PADDING + (g.pad?.x ?? 0)},bottom=${GROUP_PADDING + (g.pad?.y ?? 0)},right=${GROUP_PADDING + (g.pad?.x ?? 0)}]` },
        children: [],
        // An empty group is a black box: give it a size, since ELK sizes compound nodes from their children.
        ...(empty.has(g.id) ? (g.emptySize ?? { width: EMPTY_GROUP.width, height: EMPTY_GROUP.height + g.labelHeight }) : {}),
      });
    }
    const root: ElkNode = {
      id: "root",
      layoutOptions: { ...common, "elk.hierarchyHandling": "INCLUDE_CHILDREN", "elk.padding": `[top=${PADDING},left=${PADDING},bottom=${PADDING},right=${PADDING}]` },
      children: [],
      edges: graph.edges.map((e): ElkExtendedEdge => ({
        id: e.id,
        sources: [e.from],
        targets: [e.to],
        ...(e.label ? { labels: [{ text: e.id, width: e.label.width, height: e.label.height }] } : {}),
      })),
    };
    for (const g of groups) (g.parent ? elkNodes.get(g.parent)! : root).children!.push(elkNodes.get(g.id)!);
    for (const n of graph.nodes) (n.group ? elkNodes.get(n.group)! : root).children!.push({ id: n.id, width: n.width, height: n.height });

    const out = await this.elk.layout(root);

    // ELK child coordinates are relative to their parent; flatten to absolute.
    const nodes: LayoutResult["nodes"] = {};
    const groupBoxes: LayoutResult["groups"] = {};
    const groupIds = new Set(groups.map((g) => g.id));
    const origin = new Map<string, { x: number; y: number }>([["root", { x: 0, y: 0 }]]);
    const walk = (n: ElkNode, ox: number, oy: number) => {
      for (const c of n.children ?? []) {
        const box = { x: ox + (c.x ?? 0), y: oy + (c.y ?? 0), width: c.width ?? 0, height: c.height ?? 0 };
        if (groupIds.has(c.id)) { origin.set(c.id, { x: box.x, y: box.y }); groupBoxes[c.id] = box; walk(c, box.x, box.y); } else nodes[c.id] = box;
      }
    };
    walk(out, 0, 0);

    // Edge sections are relative to the edge's container (lowest common ancestor); ELK reports it as `container`.
    const edges: LayoutResult["edges"] = {};
    const collect = (n: ElkNode) => {
      for (const e of n.edges ?? []) {
        const s = e.sections?.[0];
        if (!s) throw new Error(`ELK returned no route for edge ${e.id}`);
        const c = (e as { container?: string }).container ?? n.id;
        const o = origin.get(c) ?? { x: 0, y: 0 };
        const points = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({ x: p.x + o.x, y: p.y + o.y }));
        const l = e.labels?.[0];
        edges[e.id] = l && l.x !== undefined && l.y !== undefined
          ? { points, labelAt: { x: l.x + o.x + (l.width ?? 0) / 2, y: l.y + o.y + (l.height ?? 0) / 2 } }
          : { points };
      }
      for (const c of n.children ?? []) collect(c);
    };
    collect(out);
    return { width: out.width ?? 0, height: out.height ?? 0, nodes, groups: groupBoxes, edges };
  }
}
