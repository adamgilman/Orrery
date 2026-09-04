#!/usr/bin/env node
// Agentic feedback loop for Orrery itself. Renders a diagram (or takes an SVG), freezes the animation into
// PNG frames with known timing, checks them, writes a contact sheet to look at, and exits non-zero on problems.
//
//   yarn inspect <file.orrery.json | file.svg> [--out <dir>] [--fps 10] [--frames 8] [--scale 2]
//
// Outputs in <out>/<name>/: static.png (t=0), frame-NN.png, sheet.png, report.json, rendered.svg
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { render, validate } from "@orrery/core";
import { ElkLayoutEngine } from "@orrery/layout-elk";
import { contactSheet, inspect, rasterize, renderFrames } from "@orrery/raster";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
if (!file) { console.error("usage: yarn inspect <file.orrery.json|file.svg> [--out dir] [--fps 10] [--frames 8] [--scale 2]"); process.exit(2); }

const fps = Number(opt("fps", 10)), frames = Number(opt("frames", 8)), scale = Number(opt("scale", 2));
const name = basename(file).replace(/\.orrery\.json$|\.json$|\.svg$/, "");
const out = join(opt("out", ".orrery-inspect"), name);
mkdirSync(out, { recursive: true });

let svg;
if (file.endsWith(".svg")) svg = readFileSync(file, "utf8");
else {
  const r = validate(JSON.parse(readFileSync(file, "utf8")));
  if (!r.ok) { for (const e of r.errors) console.error(`${file}:${e}`); process.exit(1); }
  svg = await render(r.diagram, new ElkLayoutEngine());
}
writeFileSync(join(out, "rendered.svg"), svg);

const report = inspect(svg, { scale: 1 });
writeFileSync(join(out, "static.png"), rasterize(svg, { scale }));
const seq = renderFrames(svg, { fps, durationMs: (frames * 1000) / fps, scale });
seq.forEach((f, i) => writeFileSync(join(out, `frame-${String(i).padStart(2, "0")}.png`), f.png));
writeFileSync(join(out, "sheet.png"), contactSheet(seq.map((f) => f.png), { columns: Math.min(4, seq.length) }));
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");

console.log(`${name}: ${report.size.width}x${report.size.height}, xml ${report.xml.ok ? "ok" : "BAD"}, ${report.edges.length} edges`);
for (const e of report.edges) console.log(`  ${e.periodic && (e.load === 0 || e.moving) ? "ok " : "BAD"} ${e.key.padEnd(24)} load ${String(e.load).padEnd(4)} ${e.durationMs}ms/cycle${e.load > 0 ? (e.moving ? " moving" : " STATIC") : ""}`);
for (const p of report.problems) console.log(`  problem: ${p}`);
console.log(`look at: ${join(out, "sheet.png")} (frames at ${fps} fps) and ${join(out, "static.png")}`);
process.exit(report.ok ? 0 : 1);
