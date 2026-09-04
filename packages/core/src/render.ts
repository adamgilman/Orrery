import type { LayoutEngine, LayoutResult, Point } from "./layout.js";
import { GLYPH_KINDS, GLYPH_WIDTH, toLayoutGraph } from "./measure.js";
import type { Diagram, DiagramEdge, DiagramGroup, DiagramNode, NodeKind } from "./types.js";
import { scopeDiagram, selectView } from "./view.js";

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

/** Dash pattern of the flow overlay, in user units: [dash, gap]. */
export const FLOW_DASH: readonly [number, number] = [6, 10];
/** One animation cycle shifts the dashes by exactly one pattern length, so looping is seamless. */
export const FLOW_PERIOD = FLOW_DASH[0] + FLOW_DASH[1];

/** Seconds per cycle for a given load. Pure, so frame tooling can freeze the animation at any t. */
export function flowDuration(load: number): number {
  return Math.round((0.5 + (1 - load) * 2.5) * 10) / 10;
}

export function flowWidth(load: number): number {
  return 1.5 + load * 3;
}

/** Flow animation is a pure function of load: faster and thicker as load rises, off at zero. */
export function flowStyle(load: number): string {
  const width = flowWidth(load);
  if (load <= 0) return `stroke-width:${num(width)};animation:none;opacity:0`;
  return `stroke-width:${num(width)};animation-duration:${num(flowDuration(load))}s`;
}

const STYLE = `
.group-box{fill:#e2e8f0;fill-opacity:.35;stroke:#cbd5e1;stroke-width:1.5}
.group-region .group-box{stroke-dasharray:8 6}
.group-zone .group-box{stroke-dasharray:3 5}
.group-cluster .group-box{stroke:#94a3b8}
.group-boundary .group-box{stroke:#dc2626;stroke-dasharray:6 6;fill:none}
.group-label{font:600 11px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;fill:#475569;letter-spacing:.06em;text-transform:uppercase}
.node-box{fill:#ffffff;stroke:#64748b;stroke-width:1.5}
.node-external .node-box{stroke-dasharray:5 4;fill:#f8fafc}
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
    `<g class="group group-${g.kind}" data-group="${escAttr(g.id)}">`,
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
  return [
    `<g class="node node-${n.kind}" data-node="${escAttr(n.id)}" data-kind="${n.kind}" transform="translate(${num(b.x)} ${num(b.y)})">`,
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

/** Render a laid-out diagram to a standalone SVG string. Pure and deterministic. */
export function renderSvg(diagram: Diagram, layout: LayoutResult): string {
  const groups = diagram.groups.map((g) => groupMarkup(g, layout));
  const nodes = diagram.nodes.map((n) => nodeMarkup(n, layout));
  const edges = diagram.edges.map((e) => edgeMarkup(e, layout));
  const title = diagram.title !== undefined ? `<title>${esc(diagram.title)}</title>\n` : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(layout.width)} ${num(layout.height)}" width="${num(layout.width)}" height="${num(layout.height)}" data-orrery="1">`,
    title + `<style>${STYLE}</style>`,
    // orient="auto" (not auto-start-reverse): resvg draws the latter wrong on vertical paths, and only marker-end is used.
    `<defs><marker id="arrow" viewBox="0 0 ${ARROW_LENGTH} ${ARROW_LENGTH}" refX="${ARROW_LENGTH - 1}" refY="${ARROW_LENGTH / 2}" markerWidth="${ARROW_LENGTH}" markerHeight="${ARROW_LENGTH}" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L${ARROW_LENGTH} ${ARROW_LENGTH / 2}L0 ${ARROW_LENGTH}z" fill="#94a3b8"/></marker></defs>`,
    `<g class="groups">\n${groups.join("\n")}\n</g>`,
    `<g class="edges">\n${edges.join("\n")}\n</g>`,
    `<g class="nodes">\n${nodes.join("\n")}\n</g>`,
    `</svg>`,
  ].join("\n") + "\n";
}

export interface RenderOptions { view?: string }

/** Select a view, scope the model to it, measure, lay out and render in one call. */
export async function render(diagram: Diagram, engine: LayoutEngine, options: RenderOptions = {}): Promise<string> {
  const scoped = scopeDiagram(diagram, selectView(diagram, options.view));
  const layout = await engine.layout(toLayoutGraph(scoped));
  return renderSvg(scoped, layout);
}
