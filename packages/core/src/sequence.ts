import type { Box, LayoutResult } from "./layout.js";
import { measureComponent, textWidth } from "./measure.js";
import type { Message, Model, View } from "./types.js";

/**
 * A sequence view laid out (R17): participants in order of first appearance, each its own head box on a lifeline;
 * messages as rows in order; activations from call and reply pairs. A pure function of the model and the view:
 * no engine, no coordinates in the file.
 */
export interface SequenceLayout {
  participants: { id: string; group: boolean; box: Box }[];
  messages: (Message & { index: number; y: number; x0: number; x1: number; self: boolean })[];
  activations: { id: string; x: number; y0: number; y1: number; depth: number }[];
  lifelineTop: number;
  lifelineBottom: number;
  width: number;
  height: number;
}

const MARGIN = 20, HEAD_GAP = 24, ROW = 36, MIN_GAP = 80, ACTIVATION_WIDTH = 8, NEST = 4, SELF_WIDTH = 28, LABEL_PAD = 24, HEAD_MIN_WIDTH = 80, HEAD_HEIGHT = 48;

export function layoutSequence(model: Model, view: View): SequenceLayout {
  const messages = view.messages ?? [];
  const ids: string[] = [];
  for (const m of messages) for (const id of [m.from, m.to]) if (!ids.includes(id)) ids.push(id);
  const components = new Map(model.components.map((c) => [c.id, c] as const));
  const groups = new Map(model.groups.map((g) => [g.id, g] as const));
  const headSize = (id: string) => {
    const c = components.get(id);
    if (c) return measureComponent(c, model);
    return { width: Math.max(HEAD_MIN_WIDTH, Math.ceil(textWidth((groups.get(id)?.label ?? id).length, 14) + 32)), height: HEAD_HEIGHT };
  };
  const sizes = ids.map(headSize);
  const headHeight = Math.max(...sizes.map((s) => s.height));
  const col = new Map(ids.map((id, i) => [id, i] as const));
  // Each gap between neighbouring columns is wide enough for the labels that cross it and the self loops beside it.
  const gaps = ids.slice(1).map(() => MIN_GAP);
  for (const m of messages) {
    const a = col.get(m.from)!, b = col.get(m.to)!;
    const need = (m.text ? textWidth(m.text.length, 12) : 0) + LABEL_PAD;
    if (a === b) { if (a < gaps.length) gaps[a] = Math.max(gaps[a]!, SELF_WIDTH + need); continue; }
    const [lo, hi] = a < b ? [a, b] : [b, a];
    for (let g = lo; g < hi; g++) gaps[g] = Math.max(gaps[g]!, need / (hi - lo));
  }
  const centres: number[] = [];
  let x = MARGIN;
  ids.forEach((_, i) => { x += sizes[i]!.width / 2; centres.push(x); x += sizes[i]!.width / 2 + (gaps[i] ?? 0); });
  const participants = ids.map((id, i) => ({ id, group: groups.has(id), box: { x: centres[i]! - sizes[i]!.width / 2, y: MARGIN + (headHeight - sizes[i]!.height), width: sizes[i]!.width, height: sizes[i]!.height } }));
  const lifelineTop = MARGIN + headHeight + HEAD_GAP;
  const lifelineBottom = lifelineTop + ROW * (messages.length + 1);
  // Activations: a call opens one on its receiver; the receiver's reply closes the latest; a self-message opens none.
  const open = new Map<string, { id: string; x: number; y0: number; y1: number; depth: number }[]>();
  const activations: SequenceLayout["activations"] = [];
  const ys = messages.map((_, k) => lifelineTop + ROW * (k + 1));
  messages.forEach((m, k) => {
    const y = ys[k]!;
    if (m.from === m.to) return;
    if (m.reply) { const stack = open.get(m.from); const act = stack?.pop(); if (act) act.y1 = y; return; }
    const stack = open.get(m.to) ?? [];
    const act = { id: m.to, x: centres[col.get(m.to)!]! - ACTIVATION_WIDTH / 2 + stack.length * NEST, y0: y, y1: lifelineBottom, depth: stack.length };
    activations.push(act); stack.push(act); open.set(m.to, stack);
  });
  const activeAt = (id: string, y: number) => activations.filter((a) => a.id === id && a.y0 <= y && y <= a.y1).length;
  const laid = messages.map((m, k) => {
    const y = ys[k]!, a = centres[col.get(m.from)!]!, b = centres[col.get(m.to)!]!;
    const self = m.from === m.to;
    const dir = b >= a ? 1 : -1;
    const edge = (id: string, cx: number, toward: number) => { const n = activeAt(id, y); return n ? cx + toward * (ACTIVATION_WIDTH / 2 + (n - 1) * NEST) : cx; };
    return { ...m, index: k, y, self, x0: self ? edge(m.from, a, 1) : edge(m.from, a, dir), x1: self ? edge(m.from, a, 1) : edge(m.to, b, -dir) };
  });
  const last = participants[participants.length - 1];
  const selfRoom = messages.some((m) => m.from === m.to && col.get(m.from) === ids.length - 1) ? SELF_WIDTH + LABEL_PAD + Math.max(0, ...messages.filter((m) => m.from === m.to).map((m) => textWidth((m.text ?? "").length, 12))) : 0;
  const width = Math.ceil((last ? last.box.x + last.box.width : MARGIN) + selfRoom + MARGIN);
  return { participants, messages: laid, activations, lifelineTop, lifelineBottom, width, height: lifelineBottom + MARGIN };
}

/** The same layout in the shape every other stage understands: heads are the boxes, nothing else is a node. */
export const sequenceLayoutResult = (s: SequenceLayout): LayoutResult => ({
  width: s.width, height: s.height,
  nodes: Object.fromEntries(s.participants.filter((p) => !p.group).map((p) => [p.id, p.box])),
  groups: Object.fromEntries(s.participants.filter((p) => p.group).map((p) => [p.id, p.box])),
  edges: {},
});
