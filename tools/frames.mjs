#!/usr/bin/env node
// Frame-by-frame view of a rendered SVG over a time window, every animation frozen exactly (flow, pulse, camera,
// level of detail, states, captions). For debugging motion. Usage:
//   node tools/frames.mjs <file.svg> --from 11.5 --to 13.6 --fps 5 [--scale 1] [--out dir]
// Writes frame-NN.png and sheet.png (tiled, with the time stamped in the file name list printed).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { contactSheet, freezeFrame, rasterize } from "@orrery/raster";
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : d; };
const optS = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
if (!file) { console.error("usage: node tools/frames.mjs <file.svg> --from s --to s [--fps n] [--scale n] [--out dir]"); process.exit(2); }
const from = opt("from", 0), to = opt("to", 4), fps = opt("fps", 5), scale = opt("scale", 1);
const out = join(optS("out", ".orrery-inspect"), `${basename(file, ".svg")}-frames`);
mkdirSync(out, { recursive: true });
const svg = readFileSync(file, "utf8");
const pngs = [];
for (let t = from, i = 0; t <= to + 1e-9; t += 1 / fps, i++) {
  const png = rasterize(freezeFrame(svg, t * 1000), { scale });
  writeFileSync(join(out, `frame-${String(i).padStart(2, "0")}-${t.toFixed(2)}s.png`), png);
  pngs.push(png);
}
writeFileSync(join(out, "sheet.png"), contactSheet(pngs, { columns: Math.min(4, pngs.length) }));
console.log(`${pngs.length} frames from ${from}s to ${to}s at ${fps} fps → ${out}/sheet.png`);
