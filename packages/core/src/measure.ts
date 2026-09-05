import type { LayoutGraph } from "./layout.js";
import type { Component, Kinds, Model } from "./types.js";

const COMPONENT_HEIGHT = 48;
const COMPONENT_TECH_HEIGHT = 62;
const COMPONENT_MIN_WIDTH = 80;
/** Band reserved at the top of a group frame for its title. */
export const GROUP_LABEL_HEIGHT = 24;
/** Extra width for the kind glyph drawn left of the label. */
export const GLYPH_WIDTH = 24;
/** Extra width for the expand mark on a closed group. */
export const EXPAND_MARK_WIDTH = 24;
/** Extra width for the "×n" replicas badge. */
const REPLICA_BADGE_WIDTH = 28;
const CHAR_WIDTH = 7.6; // average glyph width at 14px
const TECH_CHAR_WIDTH = 6.2; // 11px
const PADDING = 32;
const CONNECTION_LABEL_HEIGHT = 16;
const LABEL_CHAR_WIDTH = 6.6;

export const hasGlyph = (c: Component, kinds: Kinds) => kinds.components[c.kind]?.glyph !== undefined;
/** Width of a run of text at the node label size. */
export const textWidth = (chars: number, px = 14) => chars * (px * 0.54);

/** Estimate a component's box from its label, tech line, glyph and badge. Engines receive sizes; they never measure text. */
export function measureComponent(c: Component, kinds: Kinds): { width: number; height: number } {
  const glyph = hasGlyph(c, kinds) ? GLYPH_WIDTH : 0;
  const badge = c.replicas > 1 ? REPLICA_BADGE_WIDTH : 0;
  const text = Math.max(c.label.length * CHAR_WIDTH, (c.tech?.length ?? 0) * TECH_CHAR_WIDTH);
  return { width: Math.max(COMPONENT_MIN_WIDTH, Math.ceil(text + PADDING + glyph + badge)), height: c.tech !== undefined ? COMPONENT_TECH_HEIGHT : COMPONENT_HEIGHT };
}

export function measureConnectionLabel(text: string): { width: number; height: number } {
  return { width: Math.ceil(text.length * LABEL_CHAR_WIDTH + 8), height: CONNECTION_LABEL_HEIGHT };
}

/** The model as the layout engines see it: nodes, groups, edges. The only place the two vocabularies meet. */
export function toLayoutGraph(model: Model): LayoutGraph {
  return {
    direction: model.direction,
    groups: model.groups.map((g) => ({
      id: g.id,
      ...(g.parent !== undefined ? { parent: g.parent } : {}),
      labelHeight: GROUP_LABEL_HEIGHT,
      // A closed group is the size of a component with that label, plus room for the expand mark.
      ...(g.collapsed !== undefined ? { emptySize: { width: Math.max(COMPONENT_MIN_WIDTH, Math.ceil(g.label.length * CHAR_WIDTH + PADDING + EXPAND_MARK_WIDTH)), height: COMPONENT_HEIGHT } } : {}),
    })),
    nodes: model.components.map((c) => ({ id: c.id, ...measureComponent(c, model.kinds), ...(c.group !== undefined ? { group: c.group } : {}) })),
    edges: model.connections.map((c) => ({ id: c.key, from: c.from, to: c.to, ...(c.label !== undefined ? { label: measureConnectionLabel(c.label) } : {}) })),
  };
}
