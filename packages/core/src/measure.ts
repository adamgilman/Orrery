import type { LayoutGraph } from "./layout.js";
import type { Component, Kinds, Model } from "./types.js";

export const NODE_HEIGHT = 48;
export const NODE_TECH_HEIGHT = 62;
export const NODE_MIN_WIDTH = 80;
/** Band reserved at the top of a group frame for its title. */
export const GROUP_LABEL_HEIGHT = 24;
/** Extra width for the kind glyph drawn left of the label. */
export const GLYPH_WIDTH = 24;
/** Extra width for the "×n" replicas badge. */
export const REPLICA_BADGE_WIDTH = 28;
/** Box for a group with nothing inside: a black box. */
export const EMPTY_GROUP = { width: 120, height: 48 };
const CHAR_WIDTH = 7.6; // average glyph width at 14px
const TECH_CHAR_WIDTH = 6.2; // 11px
const PADDING = 32;
export const EDGE_LABEL_HEIGHT = 16;
const LABEL_CHAR_WIDTH = 6.6;

export const hasGlyph = (c: Component, kinds: Kinds) => kinds.components[c.kind]?.glyph !== undefined;

/** Estimate a component's box from its label, tech line, glyph and badge. Engines receive sizes; they never measure text. */
export function measureComponent(c: Component, kinds: Kinds): { width: number; height: number } {
  const glyph = hasGlyph(c, kinds) ? GLYPH_WIDTH : 0;
  const badge = c.replicas > 1 ? REPLICA_BADGE_WIDTH : 0;
  const text = Math.max(c.label.length * CHAR_WIDTH, (c.tech?.length ?? 0) * TECH_CHAR_WIDTH);
  return { width: Math.max(NODE_MIN_WIDTH, Math.ceil(text + PADDING + glyph + badge)), height: c.tech !== undefined ? NODE_TECH_HEIGHT : NODE_HEIGHT };
}

export function measureEdgeLabel(text: string): { width: number; height: number } {
  return { width: Math.ceil(text.length * LABEL_CHAR_WIDTH + 8), height: EDGE_LABEL_HEIGHT };
}

/** The model as the layout engines see it: nodes, groups, edges. The only place the two vocabularies meet. */
export function toLayoutGraph(model: Model): LayoutGraph {
  return {
    direction: model.direction,
    groups: model.groups.map((g) => ({ id: g.id, ...(g.parent !== undefined ? { parent: g.parent } : {}), labelHeight: GROUP_LABEL_HEIGHT })),
    nodes: model.components.map((c) => ({ id: c.id, ...measureComponent(c, model.kinds), ...(c.group !== undefined ? { group: c.group } : {}) })),
    edges: model.connections.map((c) => ({ id: c.key, from: c.from, to: c.to, ...(c.label !== undefined ? { label: measureEdgeLabel(c.label) } : {}) })),
  };
}
