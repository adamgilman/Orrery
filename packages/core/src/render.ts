import type { LayoutEngine, LayoutResult, Point } from "./layout.js";
import { FLOW_DASH, FLOW_PERIOD, PULSE_MIN_OPACITY, PULSE_PERIOD, flowStyle } from "./flow.js";
export * from "./flow.js";
import { GLYPH_KINDS, GLYPH_WIDTH, toLayoutGraph } from "./measure.js";
import type { Diagram, DiagramEdge, DiagramGroup, DiagramNode, DiagramView, NodeKind } from "./types.js";
import { scopeDiagram, selectView } from "./view.js";
import { applyScenario, propagate } from "./simulate.js";

/** Text-content escaping. */
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
/** Attribute-value escaping; ">" is legal inside a quoted attribute and kept readable for keys like "a->b". */
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const num = (n: number) => String(Math.round(n * 10) / 10);
const pathD = (pts: Point[]) => pts.map((p, i) => `${i === 0 ? "M" : "L"}${num(p.x)} ${num(p.y)}`).join(" ");

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

const STYLE = `
.group-box{fill:#e2e8f0;fill-opacity:.35;stroke:#cbd5e1;stroke-width:1.5}
.group-region .group-box{stroke-dasharray:8 6}
.group-zone .group-box{stroke-dasharray:3 5}
.group-cluster .group-box{stroke:#94a3b8}
.group-boundary .group-box{stroke:#dc2626;stroke-dasharray:6 6;fill:none}
.group-label{font:600 11px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;fill:#475569;letter-spacing:.06em;text-transform:uppercase;paint-order:stroke;stroke:#f1f5f9;stroke-width:4px;stroke-linejoin:round}
.node-box{fill:#ffffff;stroke:#64748b;stroke-width:1.5}
.node-external .node-box{stroke-dasharray:5 4;fill:#f8fafc}
.node-state-failed .node-box{fill:#fef2f2;stroke:#dc2626;stroke-width:2;animation:orrery-pulse ${PULSE_PERIOD}s linear infinite}
.node-state-failed .node-label{fill:#991b1b}
.node-state-degraded .node-box{fill:#fffbeb;stroke:#d97706;stroke-width:2}
.node-state-degraded .node-label{fill:#92400e}
.node-state-off{opacity:.45}
.node-state-off .node-box{stroke-dasharray:4 4}
.glyph{fill:none;stroke:#475569;stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round}
.glyph-text{font:600 13px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;fill:#475569;text-anchor:middle;dominant-baseline:central}
.node-label{font:500 14px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;fill:#0f172a;text-anchor:middle;dominant-baseline:central}
.edge{fill:none;stroke:#94a3b8;stroke-width:1.5}
.edge-async{stroke-dasharray:6 5}
.edge-replication{stroke-dasharray:2 4}
.edge-dataflow{stroke-width:3}
.flow{fill:none;stroke:#2563eb;stroke-linecap:round;stroke-dasharray:${FLOW_DASH[0]} ${FLOW_DASH[1]};animation:orrery-flow 1s linear infinite}
.edge-label{font:12px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;fill:#475569;text-anchor:middle;dominant-baseline:central;paint-order:stroke;stroke:#ffffff;stroke-width:5px;stroke-linejoin:round}
@keyframes orrery-flow{to{stroke-dashoffset:-${FLOW_PERIOD}}}
@keyframes orrery-pulse{0%{stroke-opacity:1}50%{stroke-opacity:${PULSE_MIN_OPACITY}}100%{stroke-opacity:1}}
`.trim();

function midpoint(pts: Point[]): Point {
  const segs = pts.slice(1).map((p, i) => ({ a: pts[i]!, b: p, len: Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y) }));
  const half = segs.reduce((s, x) => s + x.len, 0) / 2;
  let acc = 0;
  for (const s of segs) {
    if (acc + s.len >= half) {
      const t = s.len === 0 ? 0 : (half - acc) / s.len;
      return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t };
    }
    acc += s.len;
  }
  return pts[0]!;
}

/** 16×16 glyphs, stroke-based so they inherit the theme. */
const GLYPHS: Partial<Record<NodeKind, string>> = {
  database: `<ellipse cx="8" cy="4" rx="6" ry="2.5"/><path d="M2 4v8c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V4"/>`,
  queue: `<rect x="1.5" y="5" width="3.5" height="6" rx=".5"/><rect x="6.25" y="5" width="3.5" height="6" rx=".5"/><rect x="11" y="5" width="3.5" height="6" rx=".5"/>`,
  cache: `<path d="M9 1.5L3 9h4.5l-1 5.5L13 7H8.5z"/>`,
  gateway: `<path d="M8 1.5l6.5 6.5L8 14.5 1.5 8z"/>`,
  client: `<rect x="1.5" y="2.5" width="13" height="9" rx="1"/><path d="M5 14.5h6M8 11.5v3"/>`,
  storage: `<path d="M2 3.5h12l-1.5 10.5h-9z"/><path d="M2 3.5c0 1.2 2.7 2 6 2s6-.8 6-2"/>`,
  function: `<text class="glyph-text" x="8" y="8.5">λ</text>`,
};

function groupMarkup(g: DiagramGroup, layout: LayoutResult): string {
  const b = layout.groups[g.id];
  if (!b) throw new Error(`layout returned no box for group ${g.id}`);
  return [
    `<g class="group group-${g.kind}" data-group="${escAttr(g.id)}" data-bbox="${num(b.x)} ${num(b.y)} ${num(b.width)} ${num(b.height)}">`,
    `<rect class="group-box" x="${num(b.x)}" y="${num(b.y)}" width="${num(b.width)}" height="${num(b.height)}" rx="10"/>`,
    `<text class="group-label" x="${num(b.x + 12)}" y="${num(b.y + 16)}">${esc(g.label)}</text>`,
    `</g>`,
  ].join("\n");
}

function nodeMarkup(n: DiagramNode, layout: LayoutResult): string {
  const b = layout.nodes[n.id];
  if (!b) throw new Error(`layout returned no box for node ${n.id}`);
  const glyph = GLYPH_KINDS.has(n.kind) ? GLYPHS[n.kind] : undefined;
  const inset = glyph ? 12 + GLYPH_WIDTH : 0;
  const stateClass = n.state === "on" ? "" : ` node-state-${n.state}`;
  return [
    `<g class="node node-${n.kind}${stateClass}" data-node="${escAttr(n.id)}" data-kind="${n.kind}" data-state="${n.state}" data-bbox="${num(b.x)} ${num(b.y)} ${num(b.width)} ${num(b.height)}" transform="translate(${num(b.x)} ${num(b.y)})">`,
    ...(n.reason !== undefined ? [`<title>${esc(n.reason)}</title>`] : []),
    `<rect class="node-box" width="${num(b.width)}" height="${num(b.height)}" rx="8"/>`,
    ...(glyph ? [`<g class="glyph" transform="translate(12 ${num(b.height / 2 - 8)})">${glyph}</g>`] : []),
    `<text class="node-label" x="${num((inset + b.width) / 2)}" y="${num(b.height / 2)}">${esc(n.label)}</text>`,
    `</g>`,
  ].join("\n");
}

function edgeMarkup(e: DiagramEdge, layout: LayoutResult): string {
  const route = layout.edges[e.id];
  if (!route) throw new Error(`layout returned no route for edge ${e.id}`);
  const key = escAttr(e.id);
  const parts = [
    `<path class="edge edge-${e.kind}" data-edge="${key}" data-kind="${e.kind}" d="${pathD(route.points)}" marker-end="url(#arrow)"/>`,
    `<path class="flow" data-flow="${key}" data-load="${num(e.load)}" d="${pathD(trimEnd(route.points, ARROW_LENGTH))}" style="${flowStyle(e.load)}"/>`,
  ];
  if (e.label !== undefined) {
    // Engines that know label sizes hand back a centre; otherwise sit just above the route's midpoint.
    const m = route.labelAt ?? (({ x, y }) => ({ x, y: y - 8 }))(midpoint(route.points));
    parts.push(`<text class="edge-label" x="${num(m.x)}" y="${num(m.y)}">${esc(e.label)}</text>`);
  }
  return parts.join("\n");
}

/** One view's drawing: groups, then edges, then nodes, in absolute coordinates. */
export function renderView(diagram: Diagram, layout: LayoutResult): string {
  const groups = diagram.groups.map((g) => groupMarkup(g, layout));
  const nodes = diagram.nodes.map((n) => nodeMarkup(n, layout));
  const edges = diagram.edges.map((e) => edgeMarkup(e, layout));
  return [
    `<g class="groups">\n${groups.join("\n")}\n</g>`,
    `<g class="edges">\n${edges.join("\n")}\n</g>`,
    `<g class="nodes">\n${nodes.join("\n")}\n</g>`,
  ].join("\n");
}

interface ViewLayer { view: DiagramView; title: string; width: number; height: number; markup: string }

const viewLayer = (l: ViewLayer, visible: boolean) =>
  `<g class="view" data-view="${escAttr(l.view.id)}" data-title="${escAttr(l.title)}" data-size="${num(l.width)} ${num(l.height)}"${visible ? "" : ' style="display:none"'}>\n${l.markup}\n</g>`;

/** Only the CDATA terminator can break out of a CDATA section; split it across two sections. Browsers merge them. */
const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;

function wrapDocument(title: string | undefined, layers: ViewLayer[], extra: string[]): string {
  const first = layers[0]!;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(first.width)} ${num(first.height)}" width="${num(first.width)}" height="${num(first.height)}" data-orrery="1">`,
    (title !== undefined ? `<title>${esc(title)}</title>\n` : "") + `<style>${STYLE}</style>`,
    // orient="auto" (not auto-start-reverse): resvg draws the latter wrong on vertical paths, and only marker-end is used.
    `<defs><marker id="arrow" viewBox="0 0 ${ARROW_LENGTH} ${ARROW_LENGTH}" refX="${ARROW_LENGTH - 1}" refY="${ARROW_LENGTH / 2}" markerWidth="${ARROW_LENGTH}" markerHeight="${ARROW_LENGTH}" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L${ARROW_LENGTH} ${ARROW_LENGTH / 2}L0 ${ARROW_LENGTH}z" fill="#94a3b8"/></marker></defs>`,
    `<g class="scene">\n${layers.map((l, i) => viewLayer(l, i === 0)).join("\n")}\n</g>`,
    ...extra,
    `</svg>`,
  ].join("\n") + "\n";
}

/** Render a laid-out diagram (one view) to a standalone SVG string. Pure and deterministic. */
export function renderSvg(diagram: Diagram, layout: LayoutResult): string {
  const view = diagram.views[0] ?? { id: "default", type: "topology", direction: diagram.direction };
  return wrapDocument(diagram.title, [{ view, title: diagram.title ?? view.id, width: layout.width, height: layout.height, markup: renderView(diagram, layout) }], []);
}

export interface DocumentOptions {
  /** JavaScript source to embed as the runtime. Empty string embeds nothing (static document). */
  runtime: string;
}

/**
 * The shippable file: every view pre-laid-out and embedded (first visible), the validated model as JSON, and the
 * runtime script. Inside <img> it is the animated first view; opened directly, the runtime makes it interactive.
 */
export async function renderDocument(diagram: Diagram, engine: LayoutEngine, options: DocumentOptions): Promise<string> {
  const model = propagate(diagram);
  const layers: ViewLayer[] = [];
  for (const view of model.views) {
    const scoped = scopeDiagram(model, view);
    const layout = await engine.layout(toLayoutGraph(scoped));
    layers.push({ view, title: view.title ?? diagram.title ?? view.id, width: layout.width, height: layout.height, markup: renderView(scoped, layout) });
  }
  // The declared (un-propagated) model, so runtime toggles compose with authored states rather than derived ones.
  const json = JSON.stringify(diagram).replace(/]]>/g, "]]\\u003e");
  const extra = [`<script type="application/json" id="orrery-model"><![CDATA[${json}]]></script>`];
  if (options.runtime) extra.push(`<script>${cdata(options.runtime)}</script>`);
  return wrapDocument(diagram.title, layers, extra);
}

export interface RenderOptions {
  view?: string;
  /** Scenario id to apply before rendering; `step` selects how far (default: all steps). */
  scenario?: string;
  step?: number;
}

/** Select a view, apply a scenario (or just propagate base states), scope, measure, lay out and render. */
export async function render(diagram: Diagram, engine: LayoutEngine, options: RenderOptions = {}): Promise<string> {
  let model = diagram;
  if (options.scenario !== undefined) {
    const s = applyScenario(diagram, options.scenario, options.step);
    const label = diagram.scenarios.find((x) => x.id === s.scenarioId)!.label;
    const title = `${diagram.title ?? "Diagram"} — ${label} (${s.step}/${s.steps})${s.note !== undefined ? `: ${s.note}` : ""}`;
    model = { ...s.diagram, title };
  } else model = propagate(diagram);
  const scoped = scopeDiagram(model, selectView(model, options.view));
  const layout = await engine.layout(toLayoutGraph(scoped));
  return renderSvg(scoped, layout);
}
