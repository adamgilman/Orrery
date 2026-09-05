import type { LayoutEngine, LayoutResult, Point } from "./layout.js";
import { FLOW_DASH, FLOW_PERIOD, PULSE_MIN_OPACITY, PULSE_PERIOD, flowStyle } from "./flow.js";
export * from "./flow.js";
import { GLYPH_WIDTH, hasGlyph, textWidth, toLayoutGraph } from "./measure.js";
import { LOOK_PRESETS, lookOf } from "./looks.js";
export { LOOK_PRESETS, lookOf } from "./looks.js";
import { declare, ModelError, propagate } from "./simulate.js";
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
 * CSS for the author's vocabulary: one rule set per kind, then one per state. States come last so a state's look
 * wins over a kind's box or frame at equal specificity (R8). Names appear only as class names.
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
.group.collapsed .group-box{fill:#ffffff;fill-opacity:1;stroke-width:2}
.collapsed-label{font:500 14px ${FONT};fill:#0f172a;text-anchor:middle;dominant-baseline:central;letter-spacing:0;text-transform:none;stroke:none}
.group-count{font:11px ${FONT};fill:#64748b;text-anchor:middle;dominant-baseline:central}
.node-box{fill:#ffffff;stroke:#64748b;stroke-width:1.5}
.node-label{font:500 14px ${FONT};fill:#0f172a;text-anchor:middle;dominant-baseline:central}
.node-tech{font:11px ${FONT};fill:#64748b;text-anchor:middle;dominant-baseline:central}
.replicas rect{fill:#ffffff;stroke:#94a3b8;stroke-width:1.5}
.badge{font:600 11px ${FONT};fill:#475569;text-anchor:end;dominant-baseline:central}
.node[data-ghost]{opacity:.5}.node[data-ghost] .node-box{stroke-dasharray:3 3}.node[data-ghost] .node-label{font-style:italic}
.glyph{fill:none;stroke:#475569;stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round}
.glyph-text{font:600 13px ${FONT};fill:#475569;text-anchor:middle;dominant-baseline:central}
.edge{fill:none;stroke:#94a3b8;stroke-width:1.5}
.edge.need{stroke:#475569;stroke-width:2}
.edge-async{stroke-dasharray:6 5}
.edge-replication{stroke-dasharray:2 4}
.edge-dataflow{stroke-width:3}
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

function groupMarkup(g: Group, model: Model, layout: LayoutResult): string {
  const b = layout.groups[g.id];
  if (!b) throw new Error(`layout returned no box for group ${g.id}`);
  if (g.collapsed !== undefined) return [
    `<g class="group gk-${g.kind} st-${g.state} collapsed" data-group="${escAttr(g.id)}" data-bbox="${num(b.x)} ${num(b.y)} ${num(b.width)} ${num(b.height)}" data-state="${escAttr(g.state)}" data-collapsed="${g.collapsed}"${pulses(model, g.state) ? ' data-pulse="1"' : ""}>`,
    ...(g.reason !== undefined ? [`<title>${esc(g.reason)}</title>`] : []),
    `<rect class="group-box" x="${num(b.x)}" y="${num(b.y)}" width="${num(b.width)}" height="${num(b.height)}" rx="10"/>`,
    `<text class="group-label collapsed-label" x="${num(b.x + b.width / 2)}" y="${num(b.y + b.height / 2 - 7)}">${esc(g.label)}</text>`,
    `<text class="group-count" x="${num(b.x + b.width / 2)}" y="${num(b.y + b.height / 2 + 11)}">${g.collapsed} inside</text>`,
    `</g>`,
  ].join("\n");
  return [
    `<g class="group gk-${g.kind} st-${g.state}" data-group="${escAttr(g.id)}" data-bbox="${num(b.x)} ${num(b.y)} ${num(b.width)} ${num(b.height)}" data-state="${escAttr(g.state)}"${pulses(model, g.state) ? ' data-pulse="1"' : ""}>`,
    ...(g.reason !== undefined ? [`<title>${esc(g.reason)}</title>`] : []),
    `<rect class="group-box" x="${num(b.x)}" y="${num(b.y)}" width="${num(b.width)}" height="${num(b.height)}" rx="10"/>`,
    `<text class="group-label" x="${num(b.x + 12)}" y="${num(b.y + 16)}">${esc(g.label)}</text>`,
    `</g>`,
  ].join("\n");
}

function componentMarkup(c: Component, model: Model, layout: LayoutResult): string {
  const b = layout.nodes[c.id];
  if (!b) throw new Error(`layout returned no box for component ${c.id}`);
  const glyph = !c.ghost && hasGlyph(c, model.kinds) ? glyphMarkup(model.kinds.components[c.kind]!.glyph!) : undefined;
  const inset = glyph ? 12 + GLYPH_WIDTH : 0;
  const badge = c.replicas > 1;
  const labelY = c.tech !== undefined ? b.height / 2 - 8 : b.height / 2;
  return [
    `<g class="node${c.ghost ? "" : ` kind-${c.kind}`} st-${c.state}" data-node="${escAttr(c.id)}" data-kind="${escAttr(c.kind)}" data-state="${escAttr(c.state)}"${c.ghost ? ' data-ghost="1"' : ""}${pulses(model, c.state) ? ' data-pulse="1"' : ""} data-bbox="${num(b.x)} ${num(b.y)} ${num(b.width)} ${num(b.height)}" transform="translate(${num(b.x)} ${num(b.y)})">`,
    ...(c.reason !== undefined ? [`<title>${esc(c.reason)}</title>`] : []),
    ...(badge ? [`<g class="replicas"><rect x="6" y="-6" width="${num(b.width)}" height="${num(b.height)}" rx="8"/><rect x="3" y="-3" width="${num(b.width)}" height="${num(b.height)}" rx="8"/></g>`] : []),
    `<rect class="node-box" width="${num(b.width)}" height="${num(b.height)}" rx="8"/>`,
    ...(glyph ? [`<g class="glyph" transform="translate(12 ${num(b.height / 2 - 8)})">${glyph}</g>`] : []),
    `<text class="node-label" x="${num((inset + b.width - (badge ? 20 : 0)) / 2)}" y="${num(labelY)}">${esc(c.label)}</text>`,
    ...(c.tech !== undefined ? [`<text class="node-tech" x="${num((inset + b.width - (badge ? 20 : 0)) / 2)}" y="${num(b.height / 2 + 10)}">${esc(c.tech)}</text>`] : []),
    ...(badge ? [`<text class="badge" x="${num(b.width - 8)}" y="12">×${c.replicas}</text>`] : []),
    `</g>`,
  ].join("\n");
}

function connectionMarkup(c: Connection, layout: LayoutResult): string {
  const route = layout.edges[c.key];
  if (!route) throw new Error(`layout returned no route for connection ${c.key}`);
  const key = escAttr(c.key);
  const flowPts = c.bidirectional ? trimStart(trimEnd(route.points, ARROW_LENGTH), ARROW_LENGTH) : trimEnd(route.points, ARROW_LENGTH);
  const parts = [
    `<path class="edge edge-${c.kind}${c.need ? " need" : ""}" data-edge="${key}" data-kind="${c.kind}" d="${pathD(route.points)}" marker-end="url(#arrow)"${c.bidirectional ? ' marker-start="url(#arrow-start)"' : ""}/>`,
    `<path class="flow" data-flow="${key}" data-load="${num(c.load)}" d="${pathD(flowPts)}" style="${flowStyle(c.load)}"/>`,
  ];
  if (c.label !== undefined) {
    const m = route.labelAt ?? (({ x, y }) => ({ x, y: y - 8 }))(midpoint(route.points));
    parts.push(`<text class="edge-label" x="${num(m.x)}" y="${num(m.y)}">${esc(c.label)}</text>`);
  }
  return parts.join("\n");
}

/** Legend rows for every non-default state used in this (scoped, propagated) model (R9). Empty when none. */
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

/** One view's drawing: groups, then connections, then components, then legend. Returns markup and the size it needs. */
export function renderView(model: Model, layout: LayoutResult): { markup: string; width: number; height: number } {
  const legend = legendMarkup(model, layout.height + 8);
  const markup = [
    `<g class="groups">\n${model.groups.map((g) => groupMarkup(g, model, layout)).join("\n")}\n</g>`,
    `<g class="edges">\n${model.connections.map((c) => connectionMarkup(c, layout)).join("\n")}\n</g>`,
    `<g class="nodes">\n${model.components.map((c) => componentMarkup(c, model, layout)).join("\n")}\n</g>`,
    ...(legend.markup ? [legend.markup] : []),
  ].join("\n");
  return { markup, width: Math.max(layout.width, legend.width), height: layout.height + legend.height };
}

interface ViewLayer { view: View; title: string; width: number; height: number; markup: string; css?: string }

/**
 * A view that plays a scenario (R10): the base model and every step, each a complete render on the same layout,
 * stacked as `g.step` layers and cycled by a CSS visibility animation with the declared period. Pure CSS, so it
 * plays inside <img>; the runtime strips the cycle and plays the steps itself.
 */
function playingLayer(declared: Model, view: View, play: Play, layout: LayoutResult): Pick<ViewLayer, "markup" | "width" | "height" | "css"> {
  const scenario = declared.scenarios.find((s) => s.id === play.scenario)!;
  const n = scenario.steps.length;
  const frames = [
    { model: propagate(declared), caption: scenario.label },
    ...scenario.steps.map((st, i) => ({ model: propagate(declare(declared, { scenario: play.scenario, step: i + 1 }).model), caption: `Step ${i + 1} of ${n}${st.note !== undefined ? `: ${st.note}` : ""}` })),
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
    f.view.markup,
    `<text class="step-note" x="20" y="${num(height - 12)}">${esc(f.caption)}</text>`,
    `</g>`,
  ].join("\n")).join("\n");
  return { markup, width, height, css };
}

/**
 * A tour (R12): scenes, each a complete layer of a view at a moment of a scenario, centred on one canvas and
 * crossfaded by CSS with each scene's own duration. Pure CSS, so it plays inside <img>; the runtime plays the scenes
 * with its morph instead.
 */
async function tourLayer(model: Model, tour: Tour, engine: LayoutEngine, set: Record<string, string[]> | undefined): Promise<ViewLayer> {
  // Two passes: measure every scene, then render each shifted to the centre of the shared canvas, so every
  // coordinate in the file stays absolute (the frame tooling reads them as they are).
  const scenes = tour.scenes.map((sc) => {
    const view = selectView(model, sc.view);
    const merged = { ...(set ?? {}), ...(sc.set ?? {}) };
    const d = declare(model, { ...(sc.scenario !== undefined ? { scenario: sc.scenario } : {}), ...(sc.step !== undefined ? { step: sc.step } : {}), ...(Object.keys(merged).length ? { set: merged } : {}) });
    const title = view.title ?? model.title ?? view.id;
    return { sc, view, declared: d.model, title, caption: sc.note ?? (d.note !== undefined ? `${title}: ${d.note}` : title) };
  });
  const measured = [];
  for (const s of scenes) measured.push(await layerFor(s.declared, s.view, engine, undefined, s.title));
  const canvasW = Math.max(...measured.map((m) => m.width)), canvasH = Math.max(...measured.map((m) => m.height));
  const frames: { layer: ViewLayer; caption: string; seconds: number }[] = [];
  for (const [i, s] of scenes.entries()) {
    const m = measured[i]!;
    const layer = await layerFor(s.declared, s.view, engine, undefined, s.title, { dx: Math.round((canvasW - m.width) / 2), dy: Math.round((canvasH - m.height) / 2) });
    frames.push({ layer, caption: s.caption, seconds: s.sc.seconds });
  }
  const width = canvasW, height = canvasH + 24;
  const total = frames.reduce((a, f) => a + f.seconds, 0), fade = 5, n = frames.length;
  const starts = frames.map((_, k) => frames.slice(0, k).reduce((a, f) => a + f.seconds, 0));
  const pct = (k: number) => num(((starts[k] ?? total) / total) * 100);
  const at = (k: number) => Number(pct(k));
  const css = frames.map((_, k) => k === 0
    ? `@keyframes orrery-tour-0{0%{opacity:1}${pct(1)}%{opacity:1}${num(at(1) + fade)}%{opacity:0}${100 - fade}%{opacity:0}100%{opacity:1}}`
    : k === n - 1
      ? `@keyframes orrery-tour-${k}{0%{opacity:0}${pct(k)}%{opacity:0}${num(at(k) + fade)}%{opacity:1}${100 - fade}%{opacity:1}100%{opacity:0}}`
      : `@keyframes orrery-tour-${k}{0%{opacity:0}${pct(k)}%{opacity:0}${num(at(k) + fade)}%{opacity:1}${pct(k + 1)}%{opacity:1}${num(at(k + 1) + fade)}%{opacity:0}100%{opacity:0}}`).join("\n");
  const markup = frames.map((f, k) => [
    `<g class="tour" data-frame="${k}" data-view="${escAttr(f.layer.view.id)}" style="animation:orrery-tour-${k} ${num(total)}s linear infinite">`,
    f.layer.markup,
    `<text class="step-note" x="20" y="${num(height - 12)}">${esc(f.caption)}</text>`,
    `</g>`,
  ].join("\n")).join("\n");
  const first = frames[0]!.layer;
  return { view: first.view, title: model.title ?? first.view.id, width, height, markup, css };
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

/** Lay out and render one view of a declared (un-propagated) model, playing a scenario when asked. */
async function layerFor(declared: Model, view: View, engine: LayoutEngine, play: Play | undefined, title: string, shift?: { dx: number; dy: number }): Promise<ViewLayer> {
  const base = scopeModel(propagate(declared), view);
  let layout = await engine.layout(toLayoutGraph(base));
  if (shift) layout = shiftLayout(layout, shift.dx, shift.dy);
  const v = play ? playingLayer(declared, view, play, layout) : renderView(base, layout);
  return { view, title, ...v };
}
/** Hidden layers carry `style="display:none"` right after the class so the raster package can match them exactly. */
const viewLayer = (l: ViewLayer, visible: boolean) =>
  `<g class="view"${visible ? "" : ' style="display:none"'} data-view="${escAttr(l.view.id)}" data-title="${escAttr(l.title)}" data-size="${num(l.width)} ${num(l.height)}">\n${l.markup}\n</g>`;
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

/** Render a laid-out (scoped, propagated) model as one view in a standalone SVG. Pure and deterministic. */
export function renderSvg(model: Model, layout: LayoutResult): string {
  const view = model.views[0]!;
  const v = renderView(model, layout);
  return wrapDocument(model, model.title, [{ view, title: model.title ?? view.id, width: v.width, height: v.height, markup: v.markup }], []);
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

/** Select a view, apply scenario/overrides, propagate, scope, lay out and render one static view. */
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
 * runtime script. Inside <img> it is the animated first view; opened directly, the runtime makes it interactive.
 */
export async function renderDocument(model: Model, engine: LayoutEngine, options: DocumentOptions): Promise<string> {
  // The declared (un-propagated) model with overrides applied is what the runtime starts from.
  const declared = declare(model, { ...(options.set ? { set: options.set } : {}) }).model;
  const first = selectView(model, options.view);
  const layers: ViewLayer[] = [];
  for (const view of [first, ...model.views.filter((v) => v.id !== first.id)]) {
    const play = view === first ? playOf(view, options) : view.play;
    if (play && !model.scenarios.some((s) => s.id === play.scenario)) throw new ModelError(`unknown scenario "${play.scenario}"; available: ${model.scenarios.map((s) => s.id).join(", ") || "none"}`);
    layers.push(await layerFor(declared, view, engine, play, view.title ?? model.title ?? view.id));
  }
  // JSON is escaped rather than CDATA-split so tools can extract it with one regex and parse it as-is.
  const json = JSON.stringify(declared).replace(/]]>/g, "]]\\u003e");
  const extra = [`<script type="application/json" id="orrery-model"><![CDATA[${json}]]></script>`];
  if (options.runtime) extra.push(`<script>${cdata(options.runtime)}</script>`);
  return wrapDocument(model, model.title, layers, extra);
}
