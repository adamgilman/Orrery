import type { LayoutEngine, LayoutResult, Point } from "./layout.js";
import { FLOW_DASH, FLOW_PERIOD, PULSE_MIN_OPACITY, PULSE_PERIOD, flowStyle } from "./flow.js";
export * from "./flow.js";
import { EXPAND_MARK_WIDTH, GLYPH_WIDTH, groupShapeOf, hasGlyph, shapeOf, textWidth, toLayoutGraph } from "./measure.js";
import { scalePath } from "./shapes.js";
import { lineOf, lookOf } from "./looks.js";
export { LINE_STYLES, LOOK_PRESETS, lineOf, lookOf } from "./looks.js";
import { declare, ModelError, stopFlows } from "./declare.js";
import type { Callout, CalloutSide, Component, Connection, Export, Glyph, Group, GroupKindDef, HeadingAlign, Model, Play, ShapeDef, Tour, View } from "./types.js";
import { configurationsOf, openOrder, scopeModel, selectView } from "./view.js";

/** Text-content escaping. */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/**
 * Attribute-value escaping. ">" is legal inside a quoted attribute and is kept so keys like "a->b" stay readable;
 * the raster package's regexes rely on that (they match attributes by quotes, never by ">").
 */
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
/** Colours have been validated (S15); this is the renderer's own guard so nothing can close a style rule or tag. */
const css = (s: string) => s.replace(/[;{}<>"'\\]/g, "");
const num = (n: number) => String(Math.round(n * 10) / 10);
const pathD = (pts: Point[]) => pts.map((p, i) => `${i === 0 ? "M" : "L"}${num(p.x)} ${num(p.y)}`).join(" ");
/** Inter where the reader has it (our frame tooling rasterises with it), then the platform face. */
const FONT = `Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif`;
/** Type scale on the 48px box: 14 labels, 12 secondary text, 11 the group eyebrow, 13 captions. Inks: #0f172a text, #334155 captions, #64748b secondary. */

/** Arrowhead length in user units. Fixed via markerUnits="userSpaceOnUse" so it does not scale with stroke width. */
const ARROW_LENGTH = 12;

/** Shorten a polyline's final segment by `by`, dropping segments that vanish entirely. */
export function trimEnd(pts: Point[], by: number): Point[] {
  const out = pts.slice();
  let remaining = by;
  while (out.length >= 2 && remaining > 0) {
    const a = out[out.length - 2]!, b = out[out.length - 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len <= remaining) { out.pop(); remaining -= len; continue; }
    const t = (len - remaining) / len;
    out[out.length - 1] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    remaining = 0;
  }
  return out.length >= 2 ? out : pts.slice(0, 1);
}
const trimStart = (pts: Point[], by: number) => trimEnd(pts.slice().reverse(), by).reverse();

/* ---------------- representation: looks, glyphs, frames ---------------- */

/** 16×16 glyphs, stroke-based so they inherit the theme. Custom glyphs are SVG path data in the same box. */
const GLYPHS: Record<string, string> = {
  database: `<ellipse cx="8" cy="4" rx="6" ry="2.5"/><path d="M2 4v8c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V4"/>`,
  queue: `<rect x="1.5" y="5" width="3.5" height="6" rx=".5"/><rect x="6.25" y="5" width="3.5" height="6" rx=".5"/><rect x="11" y="5" width="3.5" height="6" rx=".5"/>`,
  cache: `<path d="M9 1.5L3 9h4.5l-1 5.5L13 7H8.5z"/>`,
  gateway: `<path d="M8 1.5l6.5 6.5L8 14.5 1.5 8z"/>`,
  client: `<rect x="1.5" y="2.5" width="13" height="9" rx="1"/><path d="M5 14.5h6M8 11.5v3"/>`,
  storage: `<path d="M2 3.5h12l-1.5 10.5h-9z"/><path d="M2 3.5c0 1.2 2.7 2 6 2s6-.8 6-2"/>`,
  function: `<text class="glyph-text" x="8" y="8.5">λ</text>`,
};
/** A stroke glyph in its 16×16 slot, or an icon (R13) as a nested svg 20×20, outside `.glyph` so its own colours apply. */
const glyphMarkup = (glyph: string | Glyph, height: number, pad: number) =>
  typeof glyph === "string"
    ? `<g class="glyph" transform="translate(${num(12 + pad)} ${num(height / 2 - 8)})">${GLYPHS[glyph] ?? `<path d="${escAttr(glyph)}"/>`}</g>`
    : `<svg class="icon" x="${num(10 + pad)}" y="${num(height / 2 - 10)}" width="20" height="20" viewBox="${escAttr(glyph.viewBox)}">${glyph.svg}</svg>`;
/** A component's outline at its size (R14): a rounded rect for a `corner` shape, a scaled path for a `path` shape. */
const outline = (shape: ShapeDef, b: { width: number; height: number }, cls: string, extra = "") =>
  shape.path !== undefined
    ? `<path class="${cls}"${cls === "group-box" ? ` data-shape="${escAttr(shape.path)}"` : ""} d="${scalePath(shape.path, b.width, b.height)}"${extra}/>`
    : `<rect class="${cls}" width="${num(b.width)}" height="${num(b.height)}" rx="${num(shape.corner === "round" ? b.height / 2 : shape.corner ?? 8)}"${extra}/>`;
/** A kind name as a CSS class selector: the pack prefix's colon needs escaping. */
const cls = (name: string) => name.replace(/:/g, "\\:");
const DASH = "4 4";

const FRAME_PRESETS: Record<string, { stroke?: string; fill?: string; fillOpacity?: number; dash?: boolean; dotted?: boolean }> = {
  tier: {},
  region: { dash: true },
  zone: { dotted: true },
  cluster: { stroke: "#94a3b8" },
  boundary: { stroke: "#dc2626", dash: true, fillOpacity: 0 },
};
const frameOf = (k: GroupKindDef) => (typeof k.frame === "string" ? FRAME_PRESETS[k.frame] ?? {} : k.frame);

/**
 * CSS for the author's vocabulary: one rule set per kind (components, groups, connections), then one per state.
 * States come last so a state's look wins over a kind's box or frame at equal specificity (R8). Names appear only
 * as class names.
 */
function vocabularyCss(model: Model): string {
  const rules: string[] = [];
  for (const [name, k] of Object.entries(model.kinds.components)) {
    const b = k.box; if (!b) continue;
    const props: string[] = [];
    if (b.dash) props.push("stroke-dasharray:5 4");
    if (b.fill) props.push(`fill:${css(b.fill)}`);
    if (b.stroke) props.push(`stroke:${css(b.stroke)}`);
    if (props.length) rules.push(`.kind-${cls(name)} .node-box{${props.join(";")}}`);
  }
  for (const [name, k] of Object.entries(model.kinds.groups)) {
    const f = frameOf(k);
    const props: string[] = [];
    if (f.stroke) props.push(`stroke:${css(f.stroke)}`);
    if (f.fill) props.push(`fill:${css(f.fill)}`);
    if (f.fillOpacity !== undefined) props.push(`fill-opacity:${f.fillOpacity}`);
    if (f.dash) props.push("stroke-dasharray:8 6");
    if (f.dotted) props.push("stroke-dasharray:3 5");
    if (props.length) rules.push(`.gk-${cls(name)} .group-box{${props.join(";")}}`);
  }
  for (const [name, k] of Object.entries(model.kinds.connections)) {
    const l = lineOf(k);
    const props: string[] = [];
    if (l.stroke) props.push(`stroke:${css(l.stroke)}`);
    if (l.width !== undefined) props.push(`stroke-width:${num(l.width)}`);
    if (l.dash) props.push(`stroke-dasharray:${css(l.dash)}`);
    if (props.length) rules.push(`.edge-${cls(name)}{${props.join(";")}}`);
  }
  for (const def of Object.values(model.states.define)) {
    const look = lookOf(def);
    const box: string[] = [];
    if (look.stroke) box.push(`stroke:${css(look.stroke)}`, "stroke-width:2");
    if (look.fill) box.push(`fill:${css(look.fill)}`);
    if (look.dash) box.push(`stroke-dasharray:${DASH}`);
    if (look.pulse) box.push(`animation:orrery-pulse ${PULSE_PERIOD}s linear infinite`);
    if (box.length) rules.push(`.st-${def.name} .node-box{${box.join(";")}}`, `.st-${def.name} .group-box{${box.join(";")}}`);
    if (look.text) rules.push(`.st-${def.name} .node-label{fill:${css(look.text)}}`, `.st-${def.name} .group-label{fill:${css(look.text)}}`);
    if (look.opacity !== undefined) rules.push(`.st-${def.name}{opacity:${look.opacity}}`);
  }
  return rules.join("\n");
}

const BASE_STYLE = `
.group-box{fill:#e2e8f0;fill-opacity:.35;stroke:#cbd5e1;stroke-width:1.5}
.group-label{font:700 11px ${FONT};fill:#64748b;letter-spacing:.1em;text-transform:uppercase;paint-order:stroke;stroke:#f1f5f9;stroke-width:3px;stroke-linejoin:round}
.group-label.centred{text-anchor:middle}
.group[data-collapsed] .group-box{fill-opacity:.7}
.summary-label{font:500 14px ${FONT};fill:#0f172a;text-anchor:middle;dominant-baseline:central}
.expand-mark{fill:none;stroke:#94a3b8;stroke-width:1.5;stroke-linecap:round}
.node-box{fill:#ffffff;stroke:#64748b;stroke-width:1.5}
.node-label{font:500 14px ${FONT};fill:#0f172a;text-anchor:middle;dominant-baseline:central}
.node-tech{font:12px ${FONT};fill:#64748b;text-anchor:middle;dominant-baseline:central;font-variant-numeric:tabular-nums}
.replica-box{fill:#ffffff;stroke:#94a3b8;stroke-width:1.5}
.badge{font:600 12px ${FONT};fill:#64748b;text-anchor:end;dominant-baseline:central;font-variant-numeric:tabular-nums}
.node[data-ghost]{opacity:.5}.node[data-ghost] .node-box{stroke-dasharray:3 3}.node[data-ghost] .node-label{font-style:italic}
.glyph{fill:none;stroke:#475569;stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round}
.glyph-text{font:600 13px ${FONT};fill:#475569;text-anchor:middle;dominant-baseline:central}
.edge{fill:none;stroke:#94a3b8;stroke-width:1.5}
.flow{fill:none;stroke:#2563eb;stroke-linecap:round;stroke-dasharray:${FLOW_DASH[0]} ${FLOW_DASH[1]};animation:orrery-flow 1s linear infinite}
.edge-label{font:12px ${FONT};fill:#64748b;text-anchor:middle;dominant-baseline:central;paint-order:stroke;stroke:#ffffff;stroke-width:4px;stroke-linejoin:round}
.legend text{font:12px ${FONT};fill:#64748b;dominant-baseline:central}.legend .legend-name{font-weight:600;fill:#0f172a}
.step-note{font:500 13px ${FONT};fill:#334155;dominant-baseline:central}
.callout-box{fill:#ffffff;stroke:#64748b;stroke-width:1.5}
.callout-leader{fill:none;stroke:#64748b;stroke-width:1.5}
.callout-text{font:12px ${FONT};fill:#334155;dominant-baseline:central}
.heading-back{fill:#ffffff}
.heading-title{font:600 16px ${FONT};fill:#0f172a}
.heading-text{font:12px ${FONT};fill:#64748b}
.heading-title.centred,.heading-text.centred{text-anchor:middle}
@keyframes orrery-flow{to{stroke-dashoffset:-${FLOW_PERIOD}}}
@keyframes orrery-pulse{0%{stroke-opacity:1}50%{stroke-opacity:${PULSE_MIN_OPACITY}}100%{stroke-opacity:1}}`.trim();

/* ---------------- markup ---------------- */

function midpoint(pts: Point[]): Point {
  const segs = pts.slice(1).map((p, i) => ({ a: pts[i]!, b: p, len: Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y) }));
  const half = segs.reduce((s, x) => s + x.len, 0) / 2;
  let acc = 0;
  for (const s of segs) {
    if (acc + s.len >= half) { const t = s.len === 0 ? 0 : (half - acc) / s.len; return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t }; }
    acc += s.len;
  }
  return pts[0]!;
}

const pulses = (model: Model, state: string) => !!lookOf(model.states.define[state]!).pulse;

/** Box, glyph, label: the drawing of a component inside its own `<g class="node">`, at (0,0). Reused by the tour's state variants. */
function componentBody(c: Component, model: Model, b: { width: number; height: number }): string {
  const shape = shapeOf(c, model);
  const pad = shape.pad.x;
  const glyph = !c.ghost && hasGlyph(c, model.kinds) ? glyphMarkup(model.kinds.components[c.kind]!.glyph!, b.height, pad) : undefined;
  const inset = glyph ? 12 + GLYPH_WIDTH : 0;
  const badge = c.replicas > 1;
  const labelY = c.tech !== undefined ? b.height / 2 - 8 : b.height / 2;
  return [
    ...(badge ? [`<g class="replicas"><g transform="translate(6 -6)">${outline(shape, b, "replica-box")}</g><g transform="translate(3 -3)">${outline(shape, b, "replica-box")}</g></g>`] : []),
    outline(shape, b, "node-box"),
    ...(glyph ? [glyph] : []),
    `<text class="node-label" x="${num((pad + inset + b.width - pad - (badge ? 20 : 0)) / 2)}" y="${num(labelY)}">${esc(c.label)}</text>`,
    ...(c.tech !== undefined ? [`<text class="node-tech" x="${num((pad + inset + b.width - pad - (badge ? 20 : 0)) / 2)}" y="${num(b.height / 2 + 10)}">${esc(c.tech)}</text>`] : []),
    ...(badge ? [`<text class="badge" x="${num(b.width - 8)}" y="${num(12 + shape.pad.y)}">×${c.replicas}</text>`] : []),
  ].join("\n");
}

/** The expand mark: a small boxed plus in the top-right corner of a closed group, the conventional sign that there is more inside. */
const expandMark = (w: number, pad = { x: 0, y: 0 }) => `<g class="expand-mark" transform="translate(${num(w - 22 - pad.x)} ${num(8 + pad.y)})"><rect width="14" height="14" rx="3"/><path d="M7 3.5v7M3.5 7h7"/></g>`;

/** A group's frame at (0,0): open, with its title in the band; or closed (R11), the size of a component, with its name centred and an expand mark. */
function groupBody(g: Group, model: Model, b: { width: number; height: number }): string {
  const closed = g.collapsed !== undefined;
  const shape = groupShapeOf(g, model);
  return [
    outline(shape, b, "group-box"),
    closed
      ? `<g class="summary"><text class="summary-label" x="${num((b.width - EXPAND_MARK_WIDTH) / 2)}" y="${num(b.height / 2)}">${esc(g.label)}</text>${expandMark(b.width, shape.pad)}</g>`
      : groupTitle(g.label, shape, b.width),
  ].join("\n");
}
/** A frame's title: in the band at the top left; centred on a path-shaped frame, whose corners are not where a box's are. */
const groupTitle = (label: string, shape: ShapeDef, width: number, extra = "") =>
  shape.path !== undefined
    ? `<text class="group-label centred" x="${num(width / 2)}" y="${num(16 + shape.pad.y)}"${extra}>${esc(label)}</text>`
    : `<text class="group-label" x="${num(12 + shape.pad.x)}" y="${num(16 + shape.pad.y)}"${extra}>${esc(label)}</text>`;

const entityAttrs = (e: Component | Group, model: Model) => `data-state="${escAttr(e.state)}"${pulses(model, e.state) ? ' data-pulse="1"' : ""}`;
const bboxAttr = (b: { x: number; y: number; width: number; height: number }) => `data-bbox="${num(b.x)} ${num(b.y)} ${num(b.width)} ${num(b.height)}"`;
const at = (b: { x: number; y: number }) => `transform="translate(${num(b.x)} ${num(b.y)})"`;

function groupMarkup(g: Group, model: Model, layout: LayoutResult): string {
  const b = layout.groups[g.id];
  if (!b) throw new Error(`layout returned no box for group ${g.id}`);
  return [
    `<g class="group gk-${g.kind} st-${g.state}" data-group="${escAttr(g.id)}" ${bboxAttr(b)} ${entityAttrs(g, model)}${g.collapsed !== undefined ? ` data-collapsed="${g.collapsed}"` : ""} ${at(b)}>`,
    ...(g.reason !== undefined ? [`<title>${esc(g.reason)}</title>`] : []),
    groupBody(g, model, b),
    `</g>`,
  ].join("\n");
}

function componentMarkup(c: Component, model: Model, layout: LayoutResult): string {
  const b = layout.nodes[c.id];
  if (!b) throw new Error(`layout returned no box for component ${c.id}`);
  return [
    `<g class="node${c.ghost ? "" : ` kind-${c.kind}`} st-${c.state}" data-node="${escAttr(c.id)}" data-kind="${escAttr(c.kind)}" ${entityAttrs(c, model)}${c.ghost ? ' data-ghost="1"' : ""} ${bboxAttr(b)} ${at(b)}>`,
    ...(c.reason !== undefined ? [`<title>${esc(c.reason)}</title>`] : []),
    componentBody(c, model, b),
    `</g>`,
  ].join("\n");
}

/** An edge and its flow along a route. The flow animates its own dashes, so it carries no other animation. */
function connectionMarkup(c: Connection, model: Model, route: { points: Point[]; labelAt?: Point }): string {
  const key = escAttr(c.key);
  const markers = ` marker-end="url(#arrow)"${c.bidirectional ? ' marker-start="url(#arrow-start)"' : ""}`;
  const flowPts = c.bidirectional ? trimStart(trimEnd(route.points, ARROW_LENGTH), ARROW_LENGTH) : trimEnd(route.points, ARROW_LENGTH);
  const flowColour = lineOf(model.kinds.connections[c.kind]!).flow;
  const parts = [
    `<path class="edge edge-${escAttr(c.kind)}" data-edge="${key}" data-kind="${escAttr(c.kind)}" d="${pathD(route.points)}"${markers}/>`,
    `<path class="flow" data-flow="${key}" data-load="${num(c.load)}" d="${pathD(flowPts)}" style="${flowStyle(c.load)}${flowColour ? `;stroke:${css(flowColour)}` : ""}"/>`,
  ];
  if (c.label !== undefined) {
    const m = route.labelAt ?? (({ x, y }) => ({ x, y: y - 8 }))(midpoint(route.points));
    parts.push(`<text class="edge-label" x="${num(m.x)}" y="${num(m.y)}">${esc(c.label)}</text>`);
  }
  return parts.join("\n");
}
const routeOf = (c: Connection, layout: LayoutResult) => { const r = layout.edges[c.key]; if (!r) throw new Error(`layout returned no route for connection ${c.key}`); return r; };
const edgesMarkup = (model: Model, layout: LayoutResult) => model.connections.map((c) => connectionMarkup(c, model, routeOf(c, layout))).join("\n");

/** The legend sits LEGEND_GAP below the picture, one row per state on a LEGEND_ROW pitch; a caption strip is CAPTION_STRIP tall. */
const LEGEND_ROW = 22, LEGEND_GAP = 16, CAPTION_STRIP = 28;
/* ---------------- callouts (R16) ---------------- */
const CALLOUT_MAX_WIDTH = 200, CALLOUT_PAD = 10, CALLOUT_LINE = 17, CALLOUT_GAP = 28, CALLOUT_MARGIN = 12;
const SIDES: CalloutSide[] = ["right", "bottom", "left", "top"];
interface Rect { x: number; y: number; width: number; height: number }
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
/**
 * The model's callouts as notes with leaders (R16). A note goes on the side of its target with the least overlap
 * with nodes, closed boxes, lines and earlier notes (right, bottom, left, top in that order on a tie), never above or left
 * of the canvas, unless the author pins a side. `right` and `bottom` say how far the notes reach, so the canvas grows.
 */
interface Notes { markup: string; right: number; bottom: number; left: number; top: number; /** each note's box and what it points at */ boxes: { at: string; box: Rect }[] }
function calloutsMarkup(model: Model, layout: LayoutResult): Notes {
  if (!model.callouts.length) return { markup: "", right: 0, bottom: 0, left: 0, top: 0, boxes: [] };
  const boxes: { at: string; box: Rect }[] = [];
  // Nodes, closed boxes and the lines between them are in the way; open frames are not.
  const obstacles: Rect[] = [...Object.values(layout.nodes), ...model.groups.filter((g) => g.collapsed !== undefined).map((g) => layout.groups[g.id]!)];
  for (const r of Object.values(layout.edges)) r.points.slice(1).forEach((p, i) => { const q = r.points[i]!; obstacles.push({ x: Math.min(p.x, q.x) - 2, y: Math.min(p.y, q.y) - 2, width: Math.abs(p.x - q.x) + 4, height: Math.abs(p.y - q.y) + 4 }); });
  const parts: string[] = [];
  let right = 0, bottom = 0, left = 0, top = 0;
  for (const c of model.callouts) {
    let target: Rect | undefined = layout.nodes[c.at] ?? layout.groups[c.at];
    if (!target) { const r = layout.edges[c.at]; if (!r) continue; const p = r.labelAt ?? midpoint(r.points); target = { x: p.x, y: p.y, width: 0, height: 0 }; }
    const lines = wrap(c.text, 12, CALLOUT_MAX_WIDTH - 2 * CALLOUT_PAD);
    const w = Math.ceil(Math.max(...lines.map((l) => textWidth(l.length, 12))) + 2 * CALLOUT_PAD), h = lines.length * CALLOUT_LINE + 2 * CALLOUT_PAD - 2;
    const cx = target.x + target.width / 2, cy = target.y + target.height / 2;
    const candidate: Record<CalloutSide, Rect> = {
      right: { x: target.x + target.width + CALLOUT_GAP, y: cy - h / 2, width: w, height: h },
      bottom: { x: cx - w / 2, y: target.y + target.height + CALLOUT_GAP, width: w, height: h },
      left: { x: target.x - CALLOUT_GAP - w, y: cy - h / 2, width: w, height: h },
      top: { x: cx - w / 2, y: target.y - CALLOUT_GAP - h, width: w, height: h },
    };
    const score = (r: Rect) => obstacles.reduce((s, o) => s + overlap(r, o), 0) + (r.x < 0 || r.y < 0 ? 1e9 : 0);
    const side = c.side ?? SIDES.reduce((best, s) => (score(candidate[s]) < score(candidate[best]) ? s : best));
    const box = candidate[side];
    obstacles.push(box); boxes.push({ at: c.at, box });
    const from = side === "right" ? { x: box.x, y: box.y + h / 2 } : side === "left" ? { x: box.x + w, y: box.y + h / 2 } : side === "bottom" ? { x: box.x + w / 2, y: box.y } : { x: box.x + w / 2, y: box.y + h };
    const to = side === "right" ? { x: target.x + target.width, y: cy } : side === "left" ? { x: target.x, y: cy } : side === "bottom" ? { x: cx, y: target.y + target.height } : { x: cx, y: target.y };
    const text = lines.map((l, i) => `<tspan x="${num(box.x + CALLOUT_PAD)}" dy="${i === 0 ? 0 : CALLOUT_LINE}">${esc(l)}</tspan>`).join("");
    parts.push(`<g class="callout" data-callout="${escAttr(c.at)}"><path class="callout-leader" d="M${num(from.x)} ${num(from.y)} L${num(to.x)} ${num(to.y)}" marker-end="url(#arrow)"/><rect class="callout-box" x="${num(box.x)}" y="${num(box.y)}" width="${num(w)}" height="${num(h)}" rx="4"/><text class="callout-text" x="${num(box.x + CALLOUT_PAD)}" y="${num(box.y + CALLOUT_PAD + 7)}">${text}</text></g>`);
    right = Math.max(right, box.x + w); bottom = Math.max(bottom, box.y + h); left = Math.min(left, box.x); top = Math.min(top, box.y);
  }
  return { markup: `<g class="callouts">\n${parts.join("\n")}\n</g>`, right, bottom, left, top, boxes };
}
/** A zoom takes the notes about its target along: the target's box grown to hold every note pointing at it or at something inside it (R16). */
function withNotes(box: Rect, target: string, model: Model, notes: Notes): Rect {
  const parentOf = new Map(model.groups.map((g) => [g.id, g.parent] as const));
  const groupOf = new Map(model.components.map((c) => [c.id, c.group] as const));
  const inside = (id: string) => { for (let cur = parentOf.has(id) ? parentOf.get(id) : groupOf.get(id); cur !== undefined; cur = parentOf.get(cur)) if (cur === target) return true; return false; };
  let { x, y } = box, x1 = box.x + box.width, y1 = box.y + box.height;
  for (const n of notes.boxes) if (n.at === target || inside(n.at)) { x = Math.min(x, n.box.x); y = Math.min(y, n.box.y); x1 = Math.max(x1, n.box.x + n.box.width); y1 = Math.max(y1, n.box.y + n.box.height); }
  return { x, y, width: x1 - x, height: y1 - y };
}

/** Legend rows for every non-default state used in this (scoped, declared) model (R9). Empty when none. */
function legendMarkup(model: Model, y: number): { markup: string; height: number; width: number } {
  const used = new Set([...model.components.map((c) => c.state), ...model.groups.map((g) => g.state)]);
  used.delete(model.states.default);
  const rows = Object.values(model.states.define).filter((d) => used.has(d.name));
  if (rows.length === 0) return { markup: "", height: 0, width: 0 };
  const lines = rows.map((d, i) => {
    const look = lookOf(d);
    const style = [`fill:${css(look.fill ?? "#ffffff")}`, `stroke:${css(look.stroke ?? "#64748b")}`, "stroke-width:1.5", ...(look.dash ? [`stroke-dasharray:${DASH}`] : []), ...(look.opacity !== undefined ? [`opacity:${look.opacity}`] : [])].join(";");
    return `<g transform="translate(0 ${i * LEGEND_ROW})"><rect y="1" width="12" height="12" rx="3" style="${style}"/><text x="20" y="7"><tspan class="legend-name">${esc(d.name)}</tspan>${d.description ? `: ${esc(d.description)}` : ""}</text></g>`;
  });
  const chars = Math.max(...rows.map((d) => d.name.length + (d.description ? d.description.length + 2 : 0)));
  return { markup: `<g class="legend" transform="translate(20 ${num(y)})">\n${lines.join("\n")}\n</g>`, height: rows.length * LEGEND_ROW + LEGEND_GAP, width: 20 + 20 + textWidth(chars, 12) + 20 };
}

/** One view's drawing (groups, connections, components) and its legend, apart, with the size both need together. */
export function renderView(model: Model, layout: LayoutResult): { picture: string; legend: string; width: number; height: number; layout: LayoutResult } {
  let notes = calloutsMarkup(model, layout);
  // a note pinned past the top or left edge moves the whole picture over to make room
  if (notes.left < 0 || notes.top < 0) { layout = shiftLayout(layout, Math.max(0, CALLOUT_MARGIN - notes.left), Math.max(0, CALLOUT_MARGIN - notes.top)); notes = calloutsMarkup(model, layout); }
  const bottom = Math.max(layout.height, notes.bottom + CALLOUT_MARGIN);
  const legend = legendMarkup(model, bottom + LEGEND_GAP);
  const picture = [
    `<g class="groups">\n${model.groups.map((g) => groupMarkup(g, model, layout)).join("\n")}\n</g>`,
    `<g class="edges">\n${edgesMarkup(model, layout)}\n</g>`,
    `<g class="nodes">\n${model.components.map((c) => componentMarkup(c, model, layout)).join("\n")}\n</g>`,
    ...(notes.markup ? [notes.markup] : []),
  ].join("\n");
  return { picture, legend: legend.markup, width: Math.max(layout.width, notes.right + CALLOUT_MARGIN, legend.width), height: bottom + legend.height, layout };
}
const withLegend = (v: { picture: string; legend: string }) => (v.legend ? `${v.picture}\n${v.legend}` : v.picture);

interface ViewLayer { view: View; title: string; width: number; height: number; markup: string; css?: string; open?: readonly string[]; layout?: LayoutResult }

/**
 * A view that plays a scenario (R10): the base model and every step, each a complete render on the same layout,
 * stacked as `g.step` layers and cycled by a CSS visibility animation with the declared period. Pure CSS, so it
 * plays inside <img>; the runtime strips the cycle and plays the steps itself.
 */
function playingLayer(declared: Model, view: View, play: Play, layout: LayoutResult): Pick<ViewLayer, "markup" | "width" | "height" | "css"> {
  const scenario = declared.scenarios.find((s) => s.id === play.scenario)!;
  const n = scenario.steps.length;
  const frames = [
    { model: stopFlows(declared), caption: scenario.label },
    ...scenario.steps.map((st, i) => ({ model: stopFlows(declare(declared, { scenario: play.scenario, step: i + 1 }).model), caption: `Step ${i + 1} of ${n}${st.note !== undefined ? `: ${st.note}` : ""}` })),
  ].map((f) => ({ ...f, view: renderView(scopeModel(f.model, view), layout) }));
  const height = Math.max(...frames.map((f) => f.view.height)) + CAPTION_STRIP;
  const width = Math.max(...frames.map((f) => f.view.width));
  const total = frames.length * play.seconds;
  const name = (k: number) => `orrery-play-${view.id}-${k}`;
  const pct = (k: number) => num((k / frames.length) * 100);
  const css = frames.map((_, k) => k === 0
    ? `@keyframes ${name(k)}{0%{visibility:visible}${pct(1)}%{visibility:hidden}100%{visibility:hidden}}`
    : `@keyframes ${name(k)}{0%{visibility:hidden}${pct(k)}%{visibility:visible}${pct(k + 1)}%{visibility:hidden}100%{visibility:hidden}}`).join("\n");
  const markup = frames.map((f, k) => [
    `<g class="step" data-step="${k}" style="animation:${name(k)} ${num(total)}s step-end infinite">`,
    withLegend(f.view),
    `<text class="step-note" x="20" y="${num(height - CAPTION_STRIP / 2)}">${esc(f.caption)}</text>`,
    `</g>`,
  ].join("\n")).join("\n");
  return { markup, width, height, css };
}

/** Camera transform that fits `box` (with padding) into a canvas of `size`, centred: the box is the fixed point. CSS syntax, or SVG attribute syntax. */
function cameraFor(box: { x: number; y: number; width: number; height: number }, size: { width: number; height: number }, pad = 24, syntax: "css" | "svg" = "css"): string {
  const sc = Math.min(size.width / (box.width + 2 * pad), size.height / (box.height + 2 * pad));
  const f = (v: number) => String(Math.round(v * 100) / 100);
  const px = syntax === "css" ? "px" : "", sep = syntax === "css" ? ", " : " ";
  return `translate(${f(size.width / 2)}${px}${sep}${f(size.height / 2)}${px}) scale(${String(Math.round(sc * 10000) / 10000)}) translate(${f(-(box.x + box.width / 2))}${px}${sep}${f(-(box.y + box.height / 2))}${px})`;
}

/**
 * A tour (R12). When every scene shares one view it is one drawing that moves: each scene says which closed groups
 * are open and what the camera closes on, every distinct set of open groups has its own layout, and between layouts
 * the entities that exist in both slide to their new places while frames resize, edges are swapped for the new
 * layout's, entities that appear fade in once the camera has settled, and the camera moves to the scene's zoom.
 * States crossfade. The legend and the caption are a fixed strip below the stage. Scenes across different views
 * fall back to a crossfade between whole views.
 */
async function tourLayer(model: Model, tour: Tour, engine: LayoutEngine, set: Record<string, string[]> | undefined): Promise<ViewLayer> {
  const scenes = tour.scenes.map((scene) => {
    const view = selectView(model, scene.view);
    const merged = { ...(set ?? {}), ...(scene.set ?? {}) };
    const d = declare(model, { ...(scene.scenario !== undefined ? { scenario: scene.scenario } : {}), ...(scene.step !== undefined ? { step: scene.step } : {}), ...(Object.keys(merged).length ? { set: merged } : {}), ...(scene.reasons ? { reasons: scene.reasons } : {}), ...(scene.callouts ? { callouts: scene.callouts } : {}) });
    const title = view.title ?? model.title ?? view.id;
    const stateKey = JSON.stringify([scene.scenario ?? null, scene.step ?? null, merged]);
    const open = scene.open ?? [];
    return { scene, view, declared: d.model, title, caption: scene.note ?? (d.note !== undefined ? `${title}: ${d.note}` : title), stateKey, open, configKey: open.join(" ") };
  });
  const n = scenes.length, total = scenes.reduce((a, s) => a + s.scene.seconds, 0);
  const starts = scenes.map((_, k) => scenes.slice(0, k).reduce((a, s) => a + s.scene.seconds, 0));
  // A transition has three phases that never overlap: what leaves fades (leave), the picture moves to the new
  // layout under the camera (move), then what arrives fades in once everything has settled (arrive). States
  // crossfade over the whole window; they never coincide with a move of the same thing.
  const window = Math.min(1.5, Math.min(...scenes.map((s) => s.scene.seconds)));
  const leaveEnd = window * 0.2, moveEnd = window * 0.8;
  type Phase = (k: number, turningOn: boolean) => [number, number];
  const leave: Phase = (k) => [starts[k]!, starts[k]! + leaveEnd];
  const move: Phase = (k) => [starts[k]! + leaveEnd, starts[k]! + moveEnd];
  const arrive: Phase = (k) => [starts[k]! + moveEnd, starts[k]! + window];
  const whole: Phase = (k) => [starts[k]!, starts[k]! + window];
  const staged: Phase = (k, turningOn) => (turningOn ? arrive(k, true) : leave(k, false));
  const pct = (sec: number) => `${Math.round((sec / total) * 10000) / 100}%`;
  const ease = "animation-timing-function:ease-in-out;";
  /** Keyframes for a value that holds per scene and changes at each scene boundary within one phase of the window. */
  const track = <T>(valueAt: (k: number) => T, css: (v: T) => string, phase: Phase, easing = ""): string => {
    const stops: [string, string][] = [["0%", css(valueAt(0))]];
    for (let k = 1; k < n; k++) {
      const prev = valueAt(k - 1), next = valueAt(k);
      if (prev === next) continue;
      const [from, to] = phase(k, next === true);
      stops.push([pct(from), easing + css(prev)], [pct(to), css(next)]);
    }
    stops.push(["100%", css(valueAt(n - 1))]);
    return stops.filter(([p], i) => i === 0 || p !== stops[i - 1]![0]).map(([p, v]) => `${p}{${v}}`).join("");
  };
  const opacity = (on: boolean) => (on ? "opacity:1" : "opacity:0");
  const anim = (name: string) => `animation:${name} ${num(total)}s linear infinite`;
  /** An element that is shown per scene: it carries whether it is visible at t = 0, so a still can drop what is not. */
  const shown = (name: string, isOn: (k: number) => boolean, inner: string, cls = "shown", extra = "") =>
    `<g class="${cls}"${extra} data-t0="${isOn(0) ? 1 : 0}" style="${anim(name)}">${inner}</g>`;
  const anchor = scenes[0]!.view;
  const oneView = scenes.every((s) => s.view.id === anchor.id);

  if (oneView) {
    // One layout per configuration of open groups; the scene's own states on top of it.
    const layouts = new Map<string, LayoutResult>();
    for (const s of scenes) if (!layouts.has(s.configKey)) layouts.set(s.configKey, await engine.layout(toLayoutGraph(scopeModel(stopFlows(s.declared), anchor, s.open))));
    const models = scenes.map((s) => scopeModel(stopFlows(s.declared), anchor, s.open));
    const layoutAt = (k: number) => layouts.get(scenes[k]!.configKey)!;
    const notesAt = models.map((m, k) => calloutsMarkup(m, layoutAt(k)));
    // A scene's extent is its layout plus the notes it places past the edge.
    const extent = (k: number) => ({ width: Math.max(layoutAt(k).width, notesAt[k]!.right + CALLOUT_MARGIN), height: Math.max(layoutAt(k).height, notesAt[k]!.bottom + CALLOUT_MARGIN) });
    const legends = models.map((m, k) => legendMarkup(m, extent(k).height + LEGEND_GAP));
    // The stage is the size of the whole pictures (the scenes without a zoom); a zoomed scene fits its target into
    // it, and an unzoomed scene fits its whole layout, so larger layouts never enlarge the image.
    const wide = scenes.map((s, k) => (s.scene.zoom === undefined ? k : -1)).filter((k) => k >= 0);
    const stageOf = (wide.length ? wide : [0]).map(extent);
    const stageW = Math.max(...stageOf.map((l) => l.width)), stageH = Math.max(...stageOf.map((l) => l.height));
    const width = Math.max(stageW, ...legends.map((l) => l.width));
    const height = stageH + Math.max(...legends.map((l) => l.height)) + CAPTION_STRIP;
    const stage = { width: stageW, height: stageH };
    const css: string[] = [];
    const parts: string[] = [];

    // Entities: the union over scenes. Each slides between its places, appears and leaves in the staged phases,
    // and shows one state variant at a time. A group's frame also resizes, and swaps its title for its summary.
    type Box = { x: number; y: number; width: number; height: number };
    const groupAt = (k: number, id: string) => models[k]!.groups.find((g) => g.id === id);
    const nodeAt = (k: number, id: string) => models[k]!.components.find((c) => c.id === id);
    const boxAt = (k: number, id: string): Box | undefined => layoutAt(k).groups[id] ?? layoutAt(k).nodes[id];
    /** The value in the nearest scene at or before k where the entity is present, else the first where it is. */
    const held = <T>(k: number, id: string, pick: (j: number) => T | undefined): T => {
      for (let j = k; j >= 0; j--) { const v = pick(j); if (v !== undefined) return v; }
      for (let j = k + 1; j < n; j++) { const v = pick(j); if (v !== undefined) return v; }
      throw new Error(`${id} is in no scene`);
    };
    const place = (id: string) => (k: number) => { const b = held(k, id, (j) => boxAt(j, id)); return `${num(b.x)} ${num(b.y)}`; };
    const size = (id: string) => (k: number) => { const b = held(k, id, (j) => boxAt(j, id)); return `${num(b.width)} ${num(b.height)}`; };
    const translate = (v: string) => { const [x, y] = v.split(" "); return `transform:translate(${x}px, ${y}px)`; };
    const sized = (v: string) => { const [w, h] = v.split(" "); return `width:${w}px;height:${h}px`; };
    const moved = (id: string, cls: string, attrs: string, inner: string) => {
      const b0 = held(0, id, (j) => boxAt(j, id));
      css.push(`@keyframes orrery-pos-${id}{${track(place(id), translate, move, ease)}}`);
      return `<g class="${cls}" ${attrs} ${bboxAttr(b0)} ${at(b0)} style="${anim(`orrery-pos-${id}`)}">${inner}</g>`;
    };
    const variants = <E extends Component | Group>(id: string, entityAt: (k: number) => E | undefined, body: (e: E, k: number) => string) => {
      const states = [...new Set(scenes.map((_, k) => held(k, id, (j) => entityAt(j)?.state)))];
      return states.map((st) => {
        const k0 = scenes.findIndex((_, k) => held(k, id, (j) => entityAt(j)?.state) === st);
        const e = held(k0, id, (j) => entityAt(j));
        const name = `orrery-var-${id}-${st}`;
        css.push(`@keyframes ${name}{${track((k) => held(k, id, (j) => entityAt(j)?.state) === st, opacity, whole)}}`);
        return shown(name, (k) => held(k, id, (j) => entityAt(j)?.state) === st, body(e, k0), `variant st-${st}`, ` data-state="${escAttr(st)}"`);
      }).join("\n");
    };
    const groupIds = model.groups.filter((g) => scenes.some((_, k) => groupAt(k, g.id))).map((g) => g.id);
    const componentIds = [...new Set(models.flatMap((m) => m.components.map((c) => c.id)))];
    const groupsMarkup = groupIds.map((id) => {
      const present = (k: number) => groupAt(k, id) !== undefined;
      const isOpen = (k: number) => held(k, id, (j) => { const g = groupAt(j, id); return g ? g.collapsed === undefined : undefined; });
      const g0 = held(0, id, (j) => groupAt(j, id));
      css.push(`@keyframes orrery-show-${id}{${track(present, opacity, staged)}}`);
      const shape = groupShapeOf(g0, model);
      // a path frame's size track animates its path data; a rect's, width and height
      const sizedAs = shape.path !== undefined ? (v: string) => { const [w, h] = v.split(" "); return `d:path("${scalePath(shape.path!, Number(w), Number(h))}")`; } : sized;
      css.push(`@keyframes orrery-size-${id}{${track(size(id), sizedAs, move, ease)}}`);
      css.push(`@keyframes orrery-open-${id}{${track(isOpen, opacity, staged)}}`);
      css.push(`@keyframes orrery-closed-${id}{${track((k) => !isOpen(k), opacity, staged)}}`);
      css.push(`@keyframes orrery-mark-${id}{${track((k) => { const [w] = size(id)(k).split(" "); return `${num(Number(w) - 22 - shape.pad.x)} ${num(8 + shape.pad.y)}`; }, translate, move, ease)}}`);
      css.push(`@keyframes orrery-centre-${id}{${track((k) => { const [w, h] = size(id)(k).split(" "); return `${num((Number(w) - EXPAND_MARK_WIDTH) / 2)} ${num(Number(h) / 2)}`; }, translate, move, ease)}}`);
      const b0 = held(0, id, (j) => boxAt(j, id));
      const frames = variants(id, (k) => groupAt(k, id), (g) => `${outline(shape, b0, "group-box", ` style="${anim(`orrery-size-${id}`)}"`)}${g.reason !== undefined ? `<title>${esc(g.reason)}</title>` : ""}`);
      // a centred title follows the frame's width through the tour
      if (shape.path !== undefined) css.push(`@keyframes orrery-title-${id}{${track((k) => { const [w] = size(id)(k).split(" "); return `${num(Number(w) / 2)} ${num(16 + shape.pad.y)}`; }, translate, move, ease)}}`);
      const title = shown(`orrery-open-${id}`, isOpen, shape.path !== undefined ? `<g transform="translate(${num(b0.width / 2)} ${num(16 + shape.pad.y)})" style="${anim(`orrery-title-${id}`)}"><text class="group-label centred">${esc(g0.label)}</text></g>` : groupTitle(g0.label, shape, b0.width), "detail");
      const summary = shown(`orrery-closed-${id}`, (k) => !isOpen(k),
        `<g transform="translate(${num((b0.width - EXPAND_MARK_WIDTH) / 2)} ${num(b0.height / 2)})" style="${anim(`orrery-centre-${id}`)}"><text class="summary-label">${esc(g0.label)}</text></g>` +
        `<g class="expand-mark" transform="translate(${num(b0.width - 22 - shape.pad.x)} ${num(8 + shape.pad.y)})" style="${anim(`orrery-mark-${id}`)}"><rect width="14" height="14" rx="3"/><path d="M7 3.5v7M3.5 7h7"/></g>`, "lod-summary");
      return shown(`orrery-show-${id}`, present, moved(id, `group gk-${g0.kind}`, `data-group="${escAttr(id)}"${g0.collapsed !== undefined ? ` data-collapsed="${g0.collapsed}"` : ""}`, `${frames}\n${title}\n${summary}`), "entity");
    });
    const nodesMarkup = componentIds.map((id) => {
      const present = (k: number) => nodeAt(k, id) !== undefined;
      const c0 = held(0, id, (j) => nodeAt(j, id));
      const b0 = held(0, id, (j) => boxAt(j, id));
      css.push(`@keyframes orrery-show-${id}{${track(present, opacity, staged)}}`);
      const body = variants(id, (k) => nodeAt(k, id), (c) => `${c.reason !== undefined ? `<title>${esc(c.reason)}</title>` : ""}${componentBody(c, model, b0)}`);
      return shown(`orrery-show-${id}`, present, moved(id, `node${c0.ghost ? "" : ` kind-${c0.kind}`}`, `data-node="${escAttr(id)}" data-kind="${escAttr(c0.kind)}"${c0.ghost ? ' data-ghost="1"' : ""}`, body), "entity");
    });
    // Edges: one set per distinct drawing (layout and loads), swapped in the staged phases when the layout changes,
    // crossfaded when only the loads do.
    // Callouts: one set per scene's distinct notes, arriving and leaving in the staged phases like captions.
    const calloutKeys = [...new Set(notesAt.map((n) => n.markup))].filter(Boolean);
    const calloutsAll = calloutKeys.map((markup, i) => {
      const isOn = (k: number) => notesAt[k]!.markup === markup;
      css.push(`@keyframes orrery-callouts-${i}{${track(isOn, opacity, staged)}}`);
      return shown(`orrery-callouts-${i}`, isOn, markup, "callouts", ` data-callouts="${i}"`);
    });
    const edgeSets = models.map((m, k) => edgesMarkup(m, layoutAt(k)));
    const edgeKeys = [...new Set(edgeSets)];
    const edgesPhase: Phase = (k, on) => (scenes[k]!.configKey !== scenes[k - 1]!.configKey ? staged(k, on) : whole(k, on));
    const edgesMarkupAll = edgeKeys.map((markup, i) => {
      const isOn = (k: number) => edgeSets[k] === markup;
      css.push(`@keyframes orrery-edges-${i}{${track(isOn, opacity, edgesPhase)}}`);
      return shown(`orrery-edges-${i}`, isOn, markup, "edges", ` data-edges="${i}"`);
    });
    // Legend variants, outside the camera; captions, staged.
    const legendKeys = [...new Set(legends.map((l) => l.markup))].filter(Boolean);
    const legendsMarkup = legendKeys.map((markup, i) => {
      const isOn = (k: number) => legends[k]!.markup === markup;
      css.push(`@keyframes orrery-legend-${i}{${track(isOn, opacity, whole)}}`);
      return shown(`orrery-legend-${i}`, isOn, markup.replace(/translate\(20 [\d.]+\)/, `translate(20 ${num(stageH + 8)})`), "legend-variant");
    });
    const captions = scenes.map((sc, k) => {
      css.push(`@keyframes orrery-caption-${k}{${track((j) => j === k, opacity, staged)}}`);
      return `<text class="step-note" x="20" y="${num(height - CAPTION_STRIP / 2)}" data-t0="${k === 0 ? 1 : 0}" style="${anim(`orrery-caption-${k}`)}">${esc(sc.caption)}</text>`;
    });
    // The camera closes on the scene's zoom in its layout, or fits the whole layout when there is none.
    const cameraBox = (k: number) => { const z = scenes[k]!.scene.zoom; const l = layoutAt(k); const b = z ? l.groups[z] ?? l.nodes[z] : undefined; return b && z ? withNotes(b, z, models[k]!, notesAt[k]!) : { x: 0, y: 0, ...extent(k) }; };
    const cameraAt = (k: number) => cameraFor(cameraBox(k), stage, scenes[k]!.scene.zoom ? 24 : 0);
    css.push(`@keyframes orrery-camera{${track(cameraAt, (v) => `transform:${v}`, move, ease)}}`);
    parts.push(
      `<clipPath id="orrery-stage-${escAttr(anchor.id)}"><rect width="${num(stage.width)}" height="${num(stage.height)}"/></clipPath>`,
      `<g class="stage" clip-path="url(#orrery-stage-${escAttr(anchor.id)})">`,
      `<g class="camera" data-stage="${num(stage.width)} ${num(stage.height)}" transform="${cameraFor(cameraBox(0), stage, scenes[0]!.scene.zoom ? 24 : 0, "svg")}" style="${anim("orrery-camera")}">`,
      `<g class="groups">\n${groupsMarkup.join("\n")}\n</g>`,
      ...edgesMarkupAll,
      `<g class="nodes">\n${nodesMarkup.join("\n")}\n</g>`,
      ...calloutsAll,
      `</g>`,
      `</g>`,
      ...legendsMarkup,
      ...captions,
    );
    return { view: anchor, title: model.title ?? anchor.id, width, height, markup: parts.join("\n"), css: css.join("\n") };
  }

  // Different views: whole-view layers, centred on a shared canvas, crossfaded.
  const measured: ViewLayer[] = [];
  for (const s of scenes) measured.push(await layerFor(s.declared, s.view, engine, undefined, s.title));
  const canvasW = Math.max(...measured.map((m) => m.width)), canvasH = Math.max(...measured.map((m) => m.height));
  const frames: ViewLayer[] = [];
  for (const [i, s] of scenes.entries()) frames.push(await layerFor(s.declared, s.view, engine, undefined, s.title, { dx: Math.round((canvasW - measured[i]!.width) / 2), dy: Math.round((canvasH - measured[i]!.height) / 2) }));
  const height = canvasH + CAPTION_STRIP;
  const css = frames.map((_, k) => `@keyframes orrery-tour-${k}{${track((j) => j === k, opacity, whole)}}`).join("\n");
  const markup = frames.map((f, k) => [
    `<g class="tour" data-frame="${k}" data-view="${escAttr(f.view.id)}" style="animation:orrery-tour-${k} ${num(total)}s linear infinite">`,
    f.markup,
    `<text class="step-note" x="20" y="${num(height - CAPTION_STRIP / 2)}">${esc(scenes[k]!.caption)}</text>`,
    `</g>`,
  ].join("\n")).join("\n");
  return { view: anchor, title: model.title ?? anchor.id, width: canvasW, height, markup, css };
}

/** Move every box and route by (dx, dy); the canvas grows to keep containing them. */
function shiftLayout(l: LayoutResult, dx: number, dy: number): LayoutResult {
  const box = (b: { x: number; y: number; width: number; height: number }) => ({ ...b, x: b.x + dx, y: b.y + dy });
  return {
    width: l.width + dx, height: l.height + dy,
    nodes: Object.fromEntries(Object.entries(l.nodes).map(([k, b]) => [k, box(b)])),
    groups: Object.fromEntries(Object.entries(l.groups).map(([k, b]) => [k, box(b)])),
    edges: Object.fromEntries(Object.entries(l.edges).map(([k, e]) => [k, { points: e.points.map((p) => ({ x: p.x + dx, y: p.y + dy })), ...(e.labelAt ? { labelAt: { x: e.labelAt.x + dx, y: e.labelAt.y + dy } } : {}) }])),
  };
}

/** Lay out and render one view of a declared model with the given groups open, playing a scenario when asked. */
async function layerFor(declared: Model, view: View, engine: LayoutEngine, play: Play | undefined, title: string, shift?: { dx: number; dy: number }, open: readonly string[] = []): Promise<ViewLayer> {
  const base = scopeModel(stopFlows(declared), view, open);
  let layout = await engine.layout(toLayoutGraph(base));
  if (shift) layout = shiftLayout(layout, shift.dx, shift.dy);
  if (play) return { view, title, open, layout, ...playingLayer(declared, view, play, layout) };
  const v = renderView(base, layout);
  return { view, title, open, layout: v.layout, width: v.width, height: v.height, markup: withLegend(v) };
}
/** Hidden layers carry `style="display:none"` right after the class so the raster package can match them exactly. `data-open` lists the closed groups this layer opens. */
const viewLayer = (l: ViewLayer, visible: boolean) =>
  `<g class="view"${visible ? "" : ' style="display:none"'} data-view="${escAttr(l.view.id)}" data-open="${escAttr((l.open ?? []).join(" "))}" data-title="${escAttr(l.title)}" data-size="${num(l.width)} ${num(l.height)}">\n${l.markup}\n</g>`;
/** Only the CDATA terminator can break out of a CDATA section; split it across two sections. Browsers merge them. */
const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;

/** The heading block (R15): the title at 16, the description at 12 wrapped to the picture's width, on a white backing, above the scene. */
interface Heading { markup: string; height: number; width: number }
const HEADING_PAD = 20, HEADING_LINE = 17, HEADING_MIN_WIDTH = 360;
function wrap(text: string, px: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next.length, px) > maxWidth) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
function headingBlock(title: string | undefined, description: string | undefined, width: number, align: HeadingAlign): Heading | undefined {
  if (title === undefined && description === undefined) return undefined;
  const w = Math.max(width, HEADING_MIN_WIDTH);
  const x = align === "centre" ? num(w / 2) : String(HEADING_PAD), cls = align === "centre" ? " centred" : "";
  const lines = description !== undefined ? wrap(description, 12, w - 2 * HEADING_PAD) : [];
  let y = HEADING_PAD;
  const parts: string[] = [];
  if (title !== undefined) { y += 10; parts.push(`<text class="heading-title${cls}" x="${x}" y="${y}">${esc(title)}</text>`); y += 14; }
  if (lines.length) { y += 8; parts.push(`<text class="heading-text${cls}" x="${x}" y="${y}">${lines.map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : HEADING_LINE}">${esc(l)}</tspan>`).join("")}</text>`); y += (lines.length - 1) * HEADING_LINE + 4; }
  const height = y + HEADING_PAD - 4;
  return { markup: `<rect class="heading-back" width="${num(w)}" height="${num(height)}"/>\n${parts.join("\n")}`, height, width: w };
}

function wrapDocument(model: Model, title: string | undefined, layers: ViewLayer[], extra: string[], viewBox?: { x: number; y: number; width: number; height: number }, heading?: Heading): string {
  const first = layers[0]!;
  const crop = viewBox ?? { x: 0, y: 0, width: first.width, height: first.height };
  // the heading sits in a band above the crop; the scene moves down by its height
  const vb = heading ? { x: crop.x, y: crop.y, width: Math.max(crop.width, heading.width), height: crop.height + heading.height } : crop;
  const m = (id: string, reverse: boolean) => `<marker id="${id}" viewBox="0 0 ${ARROW_LENGTH} ${ARROW_LENGTH}" refX="${reverse ? 1 : ARROW_LENGTH - 1}" refY="${ARROW_LENGTH / 2}" markerWidth="${ARROW_LENGTH}" markerHeight="${ARROW_LENGTH}" markerUnits="userSpaceOnUse" orient="auto"><path d="${reverse ? `M${ARROW_LENGTH} 0L0 ${ARROW_LENGTH / 2}L${ARROW_LENGTH} ${ARROW_LENGTH}z` : `M0 0L${ARROW_LENGTH} ${ARROW_LENGTH / 2}L0 ${ARROW_LENGTH}z`}" fill="#94a3b8"/></marker>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(vb.x)} ${num(vb.y)} ${num(vb.width)} ${num(vb.height)}" width="${num(vb.width)}" height="${num(vb.height)}" data-orrery="1"${heading ? ` data-heading="${num(heading.height)}"` : ""}>`,
    (title !== undefined ? `<title>${esc(title)}</title>\n` : "") + `<style>${BASE_STYLE}\n${vocabularyCss(model)}${layers.map((l) => (l.css ? `\n${l.css}` : "")).join("")}</style>`,
    // orient="auto" (not auto-start-reverse): resvg draws the latter wrong on vertical paths.
    `<defs>${m("arrow", false)}${m("arrow-start", true)}</defs>`,
    ...(heading ? [`<g class="heading" transform="translate(${num(vb.x)} ${num(vb.y)})">\n${heading.markup}\n</g>`] : []),
    `<g class="scene"${heading ? ` transform="translate(0 ${num(heading.height)})"` : ""}>\n${layers.map((l, i) => viewLayer(l, i === 0)).join("\n")}\n</g>`,
    ...extra,
    `</svg>`,
  ].join("\n") + "\n";
}

/** Render a laid-out (scoped, declared) model as one view in a standalone SVG. Pure and deterministic. */
export function renderSvg(model: Model, layout: LayoutResult): string {
  const view = model.views[0]!;
  const v = renderView(model, layout);
  return wrapDocument(model, model.title, [{ view, title: model.title ?? view.id, width: v.width, height: v.height, markup: withLegend(v) }], []);
}

export interface RenderOptions {
  view?: string;
  /** Scenario id to apply before rendering; `step` selects how far (default: all steps). */
  scenario?: string;
  step?: number;
  /** A what-if: state name → entity ids, applied after the scenario; `reasons` gives entities their explanation. */
  set?: Record<string, string[]>;
  reasons?: Record<string, string>;
  /** Play a scenario on a timer in the rendered view, overriding the view's own `play`. Ignored with `scenario`. */
  play?: { scenario: string; seconds?: number };
  /** Render a tour of views instead of one view: `true` for the model's own tour, or an explicit list. */
  tour?: true | { views: string[]; seconds?: number };
  /** Closed groups drawn open, each with its closed ancestors listed too: a still of the inside (R11). */
  open?: string[];
  /** Callouts for this moment, drawn with the model's standing ones and a scenario step's (R16). */
  callouts?: Callout[];
  /** Draw the title and description block above the picture (R15): the view's own, else the model's. `true` centres the text; `"left"` sets it at the edge. */
  heading?: boolean | HeadingAlign;
  /** The entity the picture is cropped to, with a little air around it. */
  zoom?: string;
}

const playOf = (view: View, options: { play?: { scenario: string; seconds?: number }; scenario?: string }): Play | undefined =>
  options.scenario !== undefined ? undefined : options.play ? { scenario: options.play.scenario, seconds: options.play.seconds ?? 3 } : view.play;

/** Select a view, apply the scenario position and what-if, scope, lay out and render one static view. */
export async function render(model: Model, engine: LayoutEngine, options: RenderOptions = {}): Promise<string> {
  if (options.tour) {
    let tour: Tour;
    if (options.tour === true) {
      if (!model.tour) throw new ModelError("the model declares no tour; give --tour a list of view ids");
      tour = model.tour;
    } else {
      const seconds = options.tour.seconds ?? 4;
      tour = { seconds, scenes: options.tour.views.map((view) => ({ view, seconds })) };
    }
    const layer = await tourLayer(model, tour, engine, options.set);
    return wrapDocument(model, model.title, [layer], [], undefined, options.heading ? headingFor(model, undefined, layer.width, options.heading) : undefined);
  }
  const view = selectView(model, options.view);
  const play = playOf(view, options);
  if (play && !model.scenarios.some((s) => s.id === play.scenario)) throw new ModelError(`unknown scenario "${play.scenario}"; available: ${model.scenarios.map((s) => s.id).join(", ") || "none"}`);
  const open = openOrder(model.groups, options.open ?? []);
  for (const g of open) if (!(view.collapse ?? []).includes(g)) throw new ModelError(`"${g}" is not a closed group in view "${view.id}"; closed: ${(view.collapse ?? []).join(", ") || "none"}`);
  const d = declare(model, { ...(options.scenario !== undefined ? { scenario: options.scenario } : {}), ...(options.step !== undefined ? { step: options.step } : {}), ...(options.set ? { set: options.set } : {}), ...(options.reasons ? { reasons: options.reasons } : {}), ...(options.callouts ? { callouts: options.callouts } : {}) });
  let title = view.title ?? model.title;
  if (options.scenario !== undefined) {
    const label = model.scenarios.find((x) => x.id === options.scenario)!.label;
    title = `${model.title ?? "Model"} - ${label} (${d.step}/${d.steps})${d.note !== undefined ? `: ${d.note}` : ""}`;
  }
  const layer = await layerFor(d.model, view, engine, play, title ?? view.id, undefined, open);
  let viewBox: { x: number; y: number; width: number; height: number } | undefined;
  if (options.zoom !== undefined) {
    const target = layer.layout!.groups[options.zoom] ?? layer.layout!.nodes[options.zoom];
    if (!target) throw new ModelError(`"${options.zoom}" is not drawn in view "${view.id}" with ${open.length ? `${open.join(", ")} open` : "everything closed"}`);
    const scoped = scopeModel(stopFlows(d.model), view, open);
    const b = withNotes(target, options.zoom, scoped, calloutsMarkup(scoped, layer.layout!));
    const pad = 24;
    viewBox = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: Math.min(layer.width, b.width + 2 * pad), height: Math.min(layer.height, b.height + 2 * pad) };
  }
  return wrapDocument(model, title, [layer], [], viewBox, options.heading ? headingFor(model, view, viewBox?.width ?? layer.width, options.heading) : undefined);
}

/** Render one of the model's `exports` (MODEL.md 4.9): an enclosed file, CSS animation only. */
export function renderExport(model: Model, engine: LayoutEngine, x: Export): Promise<string> {
  if (x.tour) return render(model, engine, { tour: true, ...(x.heading ? { heading: x.heading } : {}) });
  return render(model, engine, {
    view: x.view,
    ...(x.heading ? { heading: x.heading } : {}),
    ...(x.callouts ? { callouts: x.callouts } : {}),
    ...(x.open ? { open: x.open } : {}),
    ...(x.zoom !== undefined ? { zoom: x.zoom } : {}),
    ...(x.scenario !== undefined ? { scenario: x.scenario } : {}),
    ...(x.step !== undefined ? { step: x.step } : {}),
    ...(x.set ? { set: x.set } : {}),
    ...(x.reasons ? { reasons: x.reasons } : {}),
    ...(x.play ? { play: x.play } : {}),
  });
}

export interface DocumentOptions { runtime: string; view?: string; set?: Record<string, string[]>; play?: { scenario: string; seconds?: number }; heading?: boolean | HeadingAlign }
/** The heading a picture of `view` carries: the view's title and description, falling back to the model's, sized to the picture. */
const headingFor = (model: Model, view: View | undefined, width: number, heading: boolean | HeadingAlign) => headingBlock(view?.title ?? model.title, view?.description ?? model.description, width, heading === "left" ? "left" : "centre");

/**
 * The shippable file: every view pre-laid-out and embedded (first visible), the normalised model as JSON, and the
 * runtime script. Inside <img> it is the animated first view; opened directly, the runtime makes it interactive. A
 * view with closed groups also carries one layer per way they can be open, so opening and closing is a morph between
 * layouts the runtime never has to compute.
 */
/** The model with only the kinds and shapes its entities use: a pack is hundreds of icons, and the file should carry the few it draws. */
function usedVocabulary(model: Model): Model {
  const pick = <T>(all: Record<string, T>, names: Iterable<string>): Record<string, T> => Object.fromEntries([...new Set(names)].filter((n) => n in all).sort().map((n) => [n, all[n]!]));
  const components = pick(model.kinds.components, model.components.map((c) => c.kind));
  const groups = pick(model.kinds.groups, model.groups.map((g) => g.kind));
  const connections = pick(model.kinds.connections, model.connections.map((c) => c.kind));
  const shapes = pick(model.shapes, ["box", ...Object.values(components).map((k) => k.shape), ...Object.values(groups).map((k) => k.shape)].filter((s): s is string => s !== undefined));
  return { ...model, kinds: { components, groups, connections }, shapes };
}

/** Every scenario step's own callouts for a layer, hidden, so the runtime can show the current step's (R16). Same layout: states never move anything. */
function stepCallouts(declared: Model, view: View, open: readonly string[], layout: LayoutResult): string {
  const parts: string[] = [];
  for (const sc of declared.scenarios) sc.steps.forEach((st, i) => {
    if (!st.callouts.length) return;
    const moment = declare(declared, { scenario: sc.id, step: i + 1 }).model;
    const scoped = scopeModel(stopFlows({ ...moment, callouts: st.callouts }), view, open);
    const notes = calloutsMarkup(scoped, layout).markup;
    if (notes) parts.push(`<g class="callouts-step" data-scenario="${escAttr(sc.id)}" data-step="${i + 1}" style="display:none">\n${notes}\n</g>`);
  });
  return parts.join("\n");
}

export async function renderDocument(model: Model, engine: LayoutEngine, options: DocumentOptions): Promise<string> {
  // The declared model with the what-if applied is what the runtime starts from.
  const declared = declare(model, { ...(options.set ? { set: options.set } : {}) }).model;
  const first = selectView(model, options.view);
  const layers: ViewLayer[] = [];
  for (const view of [first, ...model.views.filter((v) => v.id !== first.id)]) {
    const play = view === first ? playOf(view, options) : view.play;
    if (play && !model.scenarios.some((s) => s.id === play.scenario)) throw new ModelError(`unknown scenario "${play.scenario}"; available: ${model.scenarios.map((s) => s.id).join(", ") || "none"}`);
    const withSteps = (layer: ViewLayer, open: readonly string[]) => (layer.css === undefined ? { ...layer, markup: [layer.markup, stepCallouts(declared, view, open, layer.layout!)].filter(Boolean).join("\n") } : layer);
    layers.push(withSteps(await layerFor(declared, view, engine, play, view.title ?? model.title ?? view.id), []));
    for (const open of configurationsOf(model.groups, view.collapse ?? [])) if (open.length) layers.push(withSteps(await layerFor(declared, view, engine, undefined, view.title ?? model.title ?? view.id, undefined, open), open));
  }
  // JSON is escaped rather than CDATA-split so tools can extract it with one regex and parse it as-is.
  const json = JSON.stringify(usedVocabulary(declared)).replace(/]]>/g, "]]\\u003e");
  const extra = [`<!-- ${"padding ".repeat(2000)} -->`, `<script type="application/json" id="orrery-model"><![CDATA[${json}]]></script>`]; // deliberate: 16 KB in every interactive file, for the ratchet to block
  if (options.runtime) extra.push(`<script>${cdata(options.runtime)}</script>`);
  return wrapDocument(model, model.title, layers, extra, undefined, options.heading ? headingFor(model, first, Math.max(...layers.map((l) => l.width)), options.heading) : undefined);
}
