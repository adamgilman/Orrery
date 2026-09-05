import type { LayoutEngine, LayoutResult, Point } from "./layout.js";
import { FLOW_DASH, FLOW_PERIOD, PULSE_MIN_OPACITY, PULSE_PERIOD, flowStyle } from "./flow.js";
export * from "./flow.js";
import { EXPAND_MARK_WIDTH, GLYPH_WIDTH, hasGlyph, textWidth, toLayoutGraph } from "./measure.js";
import { lineOf, lookOf } from "./looks.js";
export { LINE_STYLES, LOOK_PRESETS, lineOf, lookOf } from "./looks.js";
import { declare, ModelError, stopFlows } from "./declare.js";
import type { Component, Connection, Group, GroupKindDef, Model, Play, Tour, View } from "./types.js";
import { scopeModel, selectView } from "./view.js";

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
const FONT = `system-ui,-apple-system,"Segoe UI",Roboto,sans-serif`;

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
const glyphMarkup = (glyph: string) => GLYPHS[glyph] ?? `<path d="${escAttr(glyph)}"/>`;
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
    if (props.length) rules.push(`.kind-${name} .node-box{${props.join(";")}}`);
  }
  for (const [name, k] of Object.entries(model.kinds.groups)) {
    const f = frameOf(k);
    const props: string[] = [];
    if (f.stroke) props.push(`stroke:${css(f.stroke)}`);
    if (f.fill) props.push(`fill:${css(f.fill)}`);
    if (f.fillOpacity !== undefined) props.push(`fill-opacity:${f.fillOpacity}`);
    if (f.dash) props.push("stroke-dasharray:8 6");
    if (f.dotted) props.push("stroke-dasharray:3 5");
    if (props.length) rules.push(`.gk-${name} .group-box{${props.join(";")}}`);
  }
  for (const [name, k] of Object.entries(model.kinds.connections)) {
    const l = lineOf(k);
    const props: string[] = [];
    if (l.stroke) props.push(`stroke:${css(l.stroke)}`);
    if (l.width !== undefined) props.push(`stroke-width:${num(l.width)}`);
    if (l.dash) props.push(`stroke-dasharray:${css(l.dash)}`);
    if (props.length) rules.push(`.edge-${name}{${props.join(";")}}`);
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
.group-label{font:600 11px ${FONT};fill:#475569;letter-spacing:.06em;text-transform:uppercase;paint-order:stroke;stroke:#f1f5f9;stroke-width:4px;stroke-linejoin:round}
.group[data-collapsed] .group-box{fill-opacity:.7}
.summary-label{font:500 16px ${FONT};fill:#0f172a;text-anchor:middle;dominant-baseline:central}
.summary-open{fill:none;stroke:#94a3b8;stroke-width:1.5;stroke-linecap:round}
.node-box{fill:#ffffff;stroke:#64748b;stroke-width:1.5}
.node-label{font:500 14px ${FONT};fill:#0f172a;text-anchor:middle;dominant-baseline:central}
.node-tech{font:11px ${FONT};fill:#64748b;text-anchor:middle;dominant-baseline:central}
.replicas rect{fill:#ffffff;stroke:#94a3b8;stroke-width:1.5}
.badge{font:600 11px ${FONT};fill:#475569;text-anchor:end;dominant-baseline:central}
.node[data-ghost]{opacity:.5}.node[data-ghost] .node-box{stroke-dasharray:3 3}.node[data-ghost] .node-label{font-style:italic}
.glyph{fill:none;stroke:#475569;stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round}
.glyph-text{font:600 13px ${FONT};fill:#475569;text-anchor:middle;dominant-baseline:central}
.edge{fill:none;stroke:#94a3b8;stroke-width:1.5}
.flow{fill:none;stroke:#2563eb;stroke-linecap:round;stroke-dasharray:${FLOW_DASH[0]} ${FLOW_DASH[1]};animation:orrery-flow 1s linear infinite}
.edge-label{font:12px ${FONT};fill:#475569;text-anchor:middle;dominant-baseline:central;paint-order:stroke;stroke:#ffffff;stroke-width:5px;stroke-linejoin:round}
.legend text{font:12px ${FONT};fill:#475569;dominant-baseline:central}.legend .legend-name{font-weight:600;fill:#0f172a}
.step-note{font:500 12px ${FONT};fill:#475569;dominant-baseline:central}
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
  const glyph = !c.ghost && hasGlyph(c, model.kinds) ? glyphMarkup(model.kinds.components[c.kind]!.glyph!) : undefined;
  const inset = glyph ? 12 + GLYPH_WIDTH : 0;
  const badge = c.replicas > 1;
  const labelY = c.tech !== undefined ? b.height / 2 - 8 : b.height / 2;
  return [
    ...(badge ? [`<g class="replicas"><rect x="6" y="-6" width="${num(b.width)}" height="${num(b.height)}" rx="8"/><rect x="3" y="-3" width="${num(b.width)}" height="${num(b.height)}" rx="8"/></g>`] : []),
    `<rect class="node-box" width="${num(b.width)}" height="${num(b.height)}" rx="8"/>`,
    ...(glyph ? [`<g class="glyph" transform="translate(12 ${num(b.height / 2 - 8)})">${glyph}</g>`] : []),
    `<text class="node-label" x="${num((inset + b.width - (badge ? 20 : 0)) / 2)}" y="${num(labelY)}">${esc(c.label)}</text>`,
    ...(c.tech !== undefined ? [`<text class="node-tech" x="${num((inset + b.width - (badge ? 20 : 0)) / 2)}" y="${num(b.height / 2 + 10)}">${esc(c.tech)}</text>`] : []),
    ...(badge ? [`<text class="badge" x="${num(b.width - 8)}" y="12">×${c.replicas}</text>`] : []),
  ].join("\n");
}

/** The expand mark: a small boxed plus in the top-right corner of a closed group, the conventional sign that there is more inside. */
const expandMark = (w: number) => `<g class="summary-open" transform="translate(${num(w - 22)} 8)"><rect width="14" height="14" rx="3"/><path d="M7 3.5v7M3.5 7h7"/></g>`;

/** A group's frame at (0,0): open, with its title in the band; or closed (R11), the size of a component, with its name centred and an expand mark. */
function groupBody(g: Group, b: { width: number; height: number }): string {
  const closed = g.collapsed !== undefined;
  return [
    `<rect class="group-box" width="${num(b.width)}" height="${num(b.height)}" rx="10"/>`,
    closed
      ? `<g class="lod-summary"><text class="summary-label" x="${num((b.width - EXPAND_MARK_WIDTH) / 2)}" y="${num(b.height / 2)}">${esc(g.label)}</text>${expandMark(b.width)}</g>`
      : `<text class="group-label" x="12" y="16">${esc(g.label)}</text>`,
  ].join("\n");
}

const entityAttrs = (e: Component | Group, model: Model) => `data-state="${escAttr(e.state)}"${pulses(model, e.state) ? ' data-pulse="1"' : ""}`;
const bboxAttr = (b: { x: number; y: number; width: number; height: number }) => `data-bbox="${num(b.x)} ${num(b.y)} ${num(b.width)} ${num(b.height)}"`;
const at = (b: { x: number; y: number }) => `transform="translate(${num(b.x)} ${num(b.y)})"`;

function groupMarkup(g: Group, model: Model, layout: LayoutResult): string {
  const b = layout.groups[g.id];
  if (!b) throw new Error(`layout returned no box for group ${g.id}`);
  return [
    `<g class="group gk-${g.kind} st-${g.state}" data-group="${escAttr(g.id)}" ${bboxAttr(b)} ${entityAttrs(g, model)}${g.collapsed !== undefined ? ` data-collapsed="${g.collapsed}"` : ""} ${at(b)}>`,
    ...(g.reason !== undefined ? [`<title>${esc(g.reason)}</title>`] : []),
    groupBody(g, b),
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

/** Legend rows for every non-default state used in this (scoped, declared) model (R9). Empty when none. */
function legendMarkup(model: Model, y: number): { markup: string; height: number; width: number } {
  const used = new Set([...model.components.map((c) => c.state), ...model.groups.map((g) => g.state)]);
  used.delete(model.states.default);
  const rows = Object.values(model.states.define).filter((d) => used.has(d.name));
  if (rows.length === 0) return { markup: "", height: 0, width: 0 };
  const lines = rows.map((d, i) => {
    const look = lookOf(d);
    const style = [`fill:${css(look.fill ?? "#ffffff")}`, `stroke:${css(look.stroke ?? "#64748b")}`, "stroke-width:1.5", ...(look.dash ? [`stroke-dasharray:${DASH}`] : []), ...(look.opacity !== undefined ? [`opacity:${look.opacity}`] : [])].join(";");
    return `<g transform="translate(0 ${i * 20})"><rect width="14" height="14" rx="3" style="${style}"/><text x="22" y="7"><tspan class="legend-name">${esc(d.name)}</tspan>${d.description ? `: ${esc(d.description)}` : ""}</text></g>`;
  });
  const chars = Math.max(...rows.map((d) => d.name.length + (d.description ? d.description.length + 2 : 0)));
  return { markup: `<g class="legend" transform="translate(20 ${num(y)})">\n${lines.join("\n")}\n</g>`, height: rows.length * 20 + 10, width: 20 + 22 + textWidth(chars, 12) + 20 };
}

/** One view's drawing (groups, connections, components) and its legend, apart, with the size both need together. */
export function renderView(model: Model, layout: LayoutResult): { picture: string; legend: string; width: number; height: number } {
  const legend = legendMarkup(model, layout.height + 8);
  const picture = [
    `<g class="groups">\n${model.groups.map((g) => groupMarkup(g, model, layout)).join("\n")}\n</g>`,
    `<g class="edges">\n${edgesMarkup(model, layout)}\n</g>`,
    `<g class="nodes">\n${model.components.map((c) => componentMarkup(c, model, layout)).join("\n")}\n</g>`,
  ].join("\n");
  return { picture, legend: legend.markup, width: Math.max(layout.width, legend.width), height: layout.height + legend.height };
}
const withLegend = (v: { picture: string; legend: string }) => (v.legend ? `${v.picture}\n${v.legend}` : v.picture);

interface ViewLayer { view: View; title: string; width: number; height: number; markup: string; css?: string; open?: readonly string[] }

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
  const height = Math.max(...frames.map((f) => f.view.height)) + 24;
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
    `<text class="step-note" x="20" y="${num(height - 12)}">${esc(f.caption)}</text>`,
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
 * A tour (R12). When every scene shares one view it is one drawing that moves: each scene opens some closed groups
 * (the focus and the groups above it), every distinct set of open groups has its own layout, and between layouts
 * the entities that exist in both slide to their new places while frames resize, edges are swapped for the new
 * layout's, entities that appear fade in once the camera has settled, and the camera closes on the focus. States
 * crossfade. The legend and the caption are a fixed strip below the stage. Scenes across different views fall back
 * to a crossfade between whole views.
 */
async function tourLayer(model: Model, tour: Tour, engine: LayoutEngine, set: Record<string, string[]> | undefined): Promise<ViewLayer> {
  const parentOf = new Map(model.groups.map((g) => [g.id, g.parent] as const));
  const scenes = tour.scenes.map((scene) => {
    const view = selectView(model, scene.view);
    const merged = { ...(set ?? {}), ...(scene.set ?? {}) };
    const d = declare(model, { ...(scene.scenario !== undefined ? { scenario: scene.scenario } : {}), ...(scene.step !== undefined ? { step: scene.step } : {}), ...(Object.keys(merged).length ? { set: merged } : {}), ...(scene.reasons ? { reasons: scene.reasons } : {}) });
    const title = view.title ?? model.title ?? view.id;
    const stateKey = JSON.stringify([scene.scenario ?? null, scene.step ?? null, merged]);
    // The groups this scene opens: the focus and every closed group above it, outermost first.
    const collapse = new Set(view.collapse ?? []);
    const open: string[] = [];
    for (let cur = scene.focus; cur !== undefined; cur = parentOf.get(cur)) if (collapse.has(cur)) open.unshift(cur);
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
  const shown = (name: string, isOn: (k: number) => boolean, phase: Phase, inner: string, cls = "shown", extra = "") =>
    `<g class="${cls}"${extra} data-t0="${isOn(0) ? 1 : 0}" style="${anim(name)}">${inner}</g>`;
  const anchor = scenes[0]!.view;
  const oneView = scenes.every((s) => s.view.id === anchor.id);

  if (oneView) {
    // One layout per configuration of open groups; the scene's own states on top of it.
    const layouts = new Map<string, LayoutResult>();
    for (const s of scenes) if (!layouts.has(s.configKey)) layouts.set(s.configKey, await engine.layout(toLayoutGraph(scopeModel(stopFlows(s.declared), anchor, s.open))));
    const models = scenes.map((s) => scopeModel(stopFlows(s.declared), anchor, s.open));
    const layoutAt = (k: number) => layouts.get(scenes[k]!.configKey)!;
    const legends = models.map((m, k) => legendMarkup(m, layoutAt(k).height + 8));
    // The stage is the size of the whole-system picture (the scenes without a focus); a focused scene fits its group
    // into it, and an unfocused scene fits its whole layout, so deeper layouts never enlarge the image.
    const wide = scenes.filter((s) => s.scene.focus === undefined).map((_, i, all) => layoutAt(scenes.indexOf(all[i]!)));
    const stageOf = wide.length ? wide : [layoutAt(0)];
    const stageW = Math.max(...stageOf.map((l) => l.width)), stageH = Math.max(...stageOf.map((l) => l.height));
    const width = Math.max(stageW, ...legends.map((l) => l.width));
    const height = stageH + Math.max(...legends.map((l) => l.height)) + 24;
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
        return shown(name, (k) => held(k, id, (j) => entityAt(j)?.state) === st, whole, body(e, k0), `variant st-${st}`, ` data-state="${escAttr(st)}"`);
      }).join("\n");
    };
    const groupIds = model.groups.filter((g) => scenes.some((_, k) => groupAt(k, g.id))).map((g) => g.id);
    const componentIds = [...new Set(models.flatMap((m) => m.components.map((c) => c.id)))];
    const groupsMarkup = groupIds.map((id) => {
      const present = (k: number) => groupAt(k, id) !== undefined;
      const isOpen = (k: number) => held(k, id, (j) => { const g = groupAt(j, id); return g ? g.collapsed === undefined : undefined; });
      const g0 = held(0, id, (j) => groupAt(j, id));
      css.push(`@keyframes orrery-show-${id}{${track(present, opacity, staged)}}`);
      css.push(`@keyframes orrery-size-${id}{${track(size(id), sized, move, ease)}}`);
      css.push(`@keyframes orrery-open-${id}{${track(isOpen, opacity, staged)}}`);
      css.push(`@keyframes orrery-closed-${id}{${track((k) => !isOpen(k), opacity, staged)}}`);
      css.push(`@keyframes orrery-mark-${id}{${track((k) => { const [w] = size(id)(k).split(" "); return `${num(Number(w) - 22)} 8`; }, translate, move, ease)}}`);
      css.push(`@keyframes orrery-centre-${id}{${track((k) => { const [w, h] = size(id)(k).split(" "); return `${num((Number(w) - EXPAND_MARK_WIDTH) / 2)} ${num(Number(h) / 2)}`; }, translate, move, ease)}}`);
      const b0 = held(0, id, (j) => boxAt(j, id));
      const frames = variants(id, (k) => groupAt(k, id), (g) => `<rect class="group-box" width="${num(b0.width)}" height="${num(b0.height)}" rx="10" style="${anim(`orrery-size-${id}`)}"/>${g.reason !== undefined ? `<title>${esc(g.reason)}</title>` : ""}`);
      const title = shown(`orrery-open-${id}`, isOpen, staged, `<text class="group-label" x="12" y="16">${esc(g0.label)}</text>`, "detail");
      const summary = shown(`orrery-closed-${id}`, (k) => !isOpen(k), staged,
        `<g transform="translate(${num((b0.width - EXPAND_MARK_WIDTH) / 2)} ${num(b0.height / 2)})" style="${anim(`orrery-centre-${id}`)}"><text class="summary-label">${esc(g0.label)}</text></g>` +
        `<g class="summary-open" transform="translate(${num(b0.width - 22)} 8)" style="${anim(`orrery-mark-${id}`)}"><rect width="14" height="14" rx="3"/><path d="M7 3.5v7M3.5 7h7"/></g>`, "lod-summary");
      return shown(`orrery-show-${id}`, present, staged, moved(id, `group gk-${g0.kind}`, `data-group="${escAttr(id)}"${g0.collapsed !== undefined ? ` data-collapsed="${g0.collapsed}"` : ""}`, `${frames}\n${title}\n${summary}`), "entity");
    });
    const nodesMarkup = componentIds.map((id) => {
      const present = (k: number) => nodeAt(k, id) !== undefined;
      const c0 = held(0, id, (j) => nodeAt(j, id));
      const b0 = held(0, id, (j) => boxAt(j, id));
      css.push(`@keyframes orrery-show-${id}{${track(present, opacity, staged)}}`);
      const body = variants(id, (k) => nodeAt(k, id), (c) => `${c.reason !== undefined ? `<title>${esc(c.reason)}</title>` : ""}${componentBody(c, model, b0)}`);
      return shown(`orrery-show-${id}`, present, staged, moved(id, `node${c0.ghost ? "" : ` kind-${c0.kind}`}`, `data-node="${escAttr(id)}" data-kind="${escAttr(c0.kind)}"${c0.ghost ? ' data-ghost="1"' : ""}`, body), "entity");
    });
    // Edges: one set per distinct drawing (layout and loads), swapped in the staged phases when the layout changes,
    // crossfaded when only the loads do.
    const edgeSets = models.map((m, k) => edgesMarkup(m, layoutAt(k)));
    const edgeKeys = [...new Set(edgeSets)];
    const edgesPhase: Phase = (k, on) => (scenes[k]!.configKey !== scenes[k - 1]!.configKey ? staged(k, on) : whole(k, on));
    const edgesMarkupAll = edgeKeys.map((markup, i) => {
      const isOn = (k: number) => edgeSets[k] === markup;
      css.push(`@keyframes orrery-edges-${i}{${track(isOn, opacity, edgesPhase)}}`);
      return shown(`orrery-edges-${i}`, isOn, edgesPhase, markup, "edges", ` data-edges="${i}"`);
    });
    // Legend variants, outside the camera; captions, staged.
    const legendKeys = [...new Set(legends.map((l) => l.markup))].filter(Boolean);
    const legendsMarkup = legendKeys.map((markup, i) => {
      const isOn = (k: number) => legends[k]!.markup === markup;
      css.push(`@keyframes orrery-legend-${i}{${track(isOn, opacity, whole)}}`);
      return shown(`orrery-legend-${i}`, isOn, whole, markup.replace(/translate\(20 [\d.]+\)/, `translate(20 ${num(stageH + 8)})`), "legend-variant");
    });
    const captions = scenes.map((sc, k) => {
      css.push(`@keyframes orrery-caption-${k}{${track((j) => j === k, opacity, staged)}}`);
      return `<text class="step-note" x="20" y="${num(height - 12)}" data-t0="${k === 0 ? 1 : 0}" style="${anim(`orrery-caption-${k}`)}">${esc(sc.caption)}</text>`;
    });
    // The camera closes on the focus in its scene's layout, or fits the whole layout when there is none.
    const cameraBox = (k: number) => { const g = scenes[k]!.scene.focus; const l = layoutAt(k); return (g ? l.groups[g] : undefined) ?? { x: 0, y: 0, width: l.width, height: l.height }; };
    const cameraAt = (k: number) => cameraFor(cameraBox(k), stage, scenes[k]!.scene.focus ? 24 : 0);
    css.push(`@keyframes orrery-camera{${track(cameraAt, (v) => `transform:${v}`, move, ease)}}`);
    parts.push(
      `<clipPath id="orrery-stage-${escAttr(anchor.id)}"><rect width="${num(stage.width)}" height="${num(stage.height)}"/></clipPath>`,
      `<g class="stage" clip-path="url(#orrery-stage-${escAttr(anchor.id)})">`,
      `<g class="camera" data-stage="${num(stage.width)} ${num(stage.height)}" transform="${cameraFor(cameraBox(0), stage, scenes[0]!.scene.focus ? 24 : 0, "svg")}" style="${anim("orrery-camera")}">`,
      `<g class="groups">\n${groupsMarkup.join("\n")}\n</g>`,
      ...edgesMarkupAll,
      `<g class="nodes">\n${nodesMarkup.join("\n")}\n</g>`,
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
  const height = canvasH + 24;
  const css = frames.map((_, k) => `@keyframes orrery-tour-${k}{${track((j) => j === k, opacity, whole)}}`).join("\n");
  const markup = frames.map((f, k) => [
    `<g class="tour" data-frame="${k}" data-view="${escAttr(f.view.id)}" style="animation:orrery-tour-${k} ${num(total)}s linear infinite">`,
    f.markup,
    `<text class="step-note" x="20" y="${num(height - 12)}">${esc(scenes[k]!.caption)}</text>`,
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
  if (play) return { view, title, open, ...playingLayer(declared, view, play, layout) };
  const v = renderView(base, layout);
  return { view, title, open, width: v.width, height: v.height, markup: withLegend(v) };
}
/** Hidden layers carry `style="display:none"` right after the class so the raster package can match them exactly. `data-open` lists the closed groups this layer opens. */
const viewLayer = (l: ViewLayer, visible: boolean) =>
  `<g class="view"${visible ? "" : ' style="display:none"'} data-view="${escAttr(l.view.id)}" data-open="${escAttr((l.open ?? []).join(" "))}" data-title="${escAttr(l.title)}" data-size="${num(l.width)} ${num(l.height)}">\n${l.markup}\n</g>`;
/** Only the CDATA terminator can break out of a CDATA section; split it across two sections. Browsers merge them. */
const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;

function wrapDocument(model: Model, title: string | undefined, layers: ViewLayer[], extra: string[]): string {
  const first = layers[0]!;
  const m = (id: string, reverse: boolean) => `<marker id="${id}" viewBox="0 0 ${ARROW_LENGTH} ${ARROW_LENGTH}" refX="${reverse ? 1 : ARROW_LENGTH - 1}" refY="${ARROW_LENGTH / 2}" markerWidth="${ARROW_LENGTH}" markerHeight="${ARROW_LENGTH}" markerUnits="userSpaceOnUse" orient="auto"><path d="${reverse ? `M${ARROW_LENGTH} 0L0 ${ARROW_LENGTH / 2}L${ARROW_LENGTH} ${ARROW_LENGTH}z` : `M0 0L${ARROW_LENGTH} ${ARROW_LENGTH / 2}L0 ${ARROW_LENGTH}z`}" fill="#94a3b8"/></marker>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(first.width)} ${num(first.height)}" width="${num(first.width)}" height="${num(first.height)}" data-orrery="1">`,
    (title !== undefined ? `<title>${esc(title)}</title>\n` : "") + `<style>${BASE_STYLE}\n${vocabularyCss(model)}${layers.map((l) => (l.css ? `\n${l.css}` : "")).join("")}</style>`,
    // orient="auto" (not auto-start-reverse): resvg draws the latter wrong on vertical paths.
    `<defs>${m("arrow", false)}${m("arrow-start", true)}</defs>`,
    `<g class="scene">\n${layers.map((l, i) => viewLayer(l, i === 0)).join("\n")}\n</g>`,
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
  /** Ad-hoc declared-state overrides: state name → entity ids. Applied after the scenario. */
  set?: Record<string, string[]>;
  /** Play a scenario on a timer in the rendered view, overriding the view's own `play`. Ignored with `scenario`. */
  play?: { scenario: string; seconds?: number };
  /** Render a tour of views instead of one view: `true` for the model's own tour, or an explicit list. */
  tour?: true | { views: string[]; seconds?: number };
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
    return wrapDocument(model, model.title, [await tourLayer(model, tour, engine, options.set)], []);
  }
  const view = selectView(model, options.view);
  const play = playOf(view, options);
  if (play && !model.scenarios.some((s) => s.id === play.scenario)) throw new ModelError(`unknown scenario "${play.scenario}"; available: ${model.scenarios.map((s) => s.id).join(", ") || "none"}`);
  const d = declare(model, { ...(options.scenario !== undefined ? { scenario: options.scenario } : {}), ...(options.step !== undefined ? { step: options.step } : {}), ...(options.set ? { set: options.set } : {}) });
  let title = view.title ?? model.title;
  if (options.scenario !== undefined) {
    const label = model.scenarios.find((x) => x.id === options.scenario)!.label;
    title = `${model.title ?? "Model"} - ${label} (${d.step}/${d.steps})${d.note !== undefined ? `: ${d.note}` : ""}`;
  }
  const layer = await layerFor(d.model, view, engine, play, title ?? view.id);
  return wrapDocument(model, title, [layer], []);
}

export interface DocumentOptions { runtime: string; view?: string; set?: Record<string, string[]>; play?: { scenario: string; seconds?: number } }

/**
 * The shippable file: every view pre-laid-out and embedded (first visible), the normalised model as JSON, and the
 * runtime script. Inside <img> it is the animated first view; opened directly, the runtime makes it interactive. A
 * view with closed groups also carries one layer per group a reader can open (that group and the closed groups above
 * it), so drilling down is a morph between layouts the runtime never has to compute.
 */
export async function renderDocument(model: Model, engine: LayoutEngine, options: DocumentOptions): Promise<string> {
  // The declared model with the what-if applied is what the runtime starts from.
  const declared = declare(model, { ...(options.set ? { set: options.set } : {}) }).model;
  const first = selectView(model, options.view);
  const layers: ViewLayer[] = [];
  const parentOf = new Map(model.groups.map((g) => [g.id, g.parent] as const));
  for (const view of [first, ...model.views.filter((v) => v.id !== first.id)]) {
    const play = view === first ? playOf(view, options) : view.play;
    if (play && !model.scenarios.some((s) => s.id === play.scenario)) throw new ModelError(`unknown scenario "${play.scenario}"; available: ${model.scenarios.map((s) => s.id).join(", ") || "none"}`);
    layers.push(await layerFor(declared, view, engine, play, view.title ?? model.title ?? view.id));
    const collapse = new Set(view.collapse ?? []);
    for (const g of view.collapse ?? []) {
      const open: string[] = [];
      for (let cur: string | undefined = g; cur !== undefined; cur = parentOf.get(cur)) if (collapse.has(cur)) open.unshift(cur);
      layers.push(await layerFor(declared, view, engine, undefined, view.title ?? model.title ?? view.id, undefined, open));
    }
  }
  // JSON is escaped rather than CDATA-split so tools can extract it with one regex and parse it as-is.
  const json = JSON.stringify(declared).replace(/]]>/g, "]]\\u003e");
  const extra = [`<script type="application/json" id="orrery-model"><![CDATA[${json}]]></script>`];
  if (options.runtime) extra.push(`<script>${cdata(options.runtime)}</script>`);
  return wrapDocument(model, model.title, layers, extra);
}
