import type { LayoutEngine, LayoutResult, Point } from "./layout.js";
import { edgeId, toLayoutGraph } from "./measure.js";
import type { Diagram, DiagramEdge } from "./types.js";

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
.node-box{fill:#ffffff;stroke:#64748b;stroke-width:1.5}
.node-label{font:500 14px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;fill:#0f172a;text-anchor:middle;dominant-baseline:central}
.edge{fill:none;stroke:#94a3b8;stroke-width:1.5}
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

function edgeMarkup(e: DiagramEdge, i: number, layout: LayoutResult): string {
  const route = layout.edges[edgeId(e, i)];
  if (!route) throw new Error(`layout returned no route for edge ${e.from}->${e.to}`);
  const key = escAttr(`${e.from}->${e.to}`);
  const parts = [
    `<path class="edge" data-edge="${key}" d="${pathD(route.points)}" marker-end="url(#arrow)"/>`,
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
  const nodes = diagram.nodes.map((n) => {
    const b = layout.nodes[n.id];
    if (!b) throw new Error(`layout returned no box for node ${n.id}`);
    return [
      `<g class="node" data-node="${escAttr(n.id)}" transform="translate(${num(b.x)} ${num(b.y)})">`,
      `<rect class="node-box" width="${num(b.width)}" height="${num(b.height)}" rx="8"/>`,
      `<text class="node-label" x="${num(b.width / 2)}" y="${num(b.height / 2)}">${esc(n.label)}</text>`,
      `</g>`,
    ].join("\n");
  });
  const edges = diagram.edges.map((e, i) => edgeMarkup(e, i, layout));
  const title = diagram.title !== undefined ? `<title>${esc(diagram.title)}</title>\n` : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(layout.width)} ${num(layout.height)}" width="${num(layout.width)}" height="${num(layout.height)}" data-orrery="1">`,
    title + `<style>${STYLE}</style>`,
    // orient="auto" (not auto-start-reverse): resvg draws the latter wrong on vertical paths, and only marker-end is used.
    `<defs><marker id="arrow" viewBox="0 0 ${ARROW_LENGTH} ${ARROW_LENGTH}" refX="${ARROW_LENGTH - 1}" refY="${ARROW_LENGTH / 2}" markerWidth="${ARROW_LENGTH}" markerHeight="${ARROW_LENGTH}" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L${ARROW_LENGTH} ${ARROW_LENGTH / 2}L0 ${ARROW_LENGTH}z" fill="#94a3b8"/></marker></defs>`,
    `<g class="edges">\n${edges.join("\n")}\n</g>`,
    `<g class="nodes">\n${nodes.join("\n")}\n</g>`,
    `</svg>`,
  ].join("\n") + "\n";
}

/** Measure, lay out and render in one call. */
export async function render(diagram: Diagram, engine: LayoutEngine): Promise<string> {
  const layout = await engine.layout(toLayoutGraph(diagram));
  return renderSvg(diagram, layout);
}
