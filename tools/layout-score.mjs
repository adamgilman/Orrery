// Score a layout so ELK tuning is measured, not eyeballed. Usage: node tools/layout-score.mjs <file.orrery.json> [--view id]
// Prints bends, total edge length, edges passing through unrelated nodes, edges crossing group frames, and canvas area.
import { readFileSync } from "node:fs";
import { validate, toLayoutGraph, scopeModel, selectView } from "@orrery/core";
import { ElkLayoutEngine } from "@orrery/layout-elk";

export function score(graph, r) {
  const nodeOf = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  const segHitsBox = (a, b, box) => {
    // axis-aligned segments only (orthogonal routing)
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    return x1 > box.x + 0.5 && x0 < box.x + box.width - 0.5 && y1 > box.y + 0.5 && y0 < box.y + box.height - 0.5;
  };
  let bends = 0, length = 0, throughNodes = 0, frameCrossings = 0;
  const groupIds = new Set((graph.groups ?? []).map((g) => g.id));
  const containerOf = (id) => nodeOf[id]?.group ?? (groupIds.has(id) ? id : undefined);
  const ancestors = (gid) => { const out = new Set(); const p = Object.fromEntries((graph.groups ?? []).map((g) => [g.id, g.parent])); for (let c = gid; c; c = p[c]) out.add(c); return out; };
  for (const e of graph.edges) {
    const pts = r.edges[e.id].points;
    bends += Math.max(0, pts.length - 2);
    for (let i = 1; i < pts.length; i++) {
      length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      for (const [id, box] of Object.entries(r.nodes)) if (id !== e.from && id !== e.to && segHitsBox(pts[i - 1], pts[i], box)) throughNodes++;
    }
    // a frame crossing is a route entering a group that contains neither endpoint (allowed ones are the endpoints' ancestors)
    const allowed = new Set([...ancestors(containerOf(e.from)), ...ancestors(containerOf(e.to))]);
    for (const [gid, box] of Object.entries(r.groups)) {
      if (allowed.has(gid)) continue;
      for (let i = 1; i < pts.length; i++) if (segHitsBox(pts[i - 1], pts[i], box)) { frameCrossings++; break; }
    }
  }
  return { bends, length: Math.round(length), throughNodes, frameCrossings, area: Math.round(r.width * r.height / 1000), w: Math.round(r.width), h: Math.round(r.height) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  const vi = process.argv.indexOf("--view");
  const r = validate(JSON.parse(readFileSync(file, "utf8")));
  if (!r.ok) { for (const e of r.errors) console.error(`${file}:${e}`); process.exit(1); }
  const d = r.model;
  const g = toLayoutGraph(scopeModel(d, selectView(d, vi > 0 ? process.argv[vi + 1] : undefined)));
  console.log(JSON.stringify(score(g, await new ElkLayoutEngine().layout(g))));
}
