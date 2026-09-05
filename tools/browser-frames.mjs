#!/usr/bin/env node
// Frame-by-frame view of an SVG as a real browser draws it. Headless Chromium loads the file, pauses every CSS
// animation (Web Animations API), sets them all to time t, and screenshots. Usage:
//   node tools/browser-frames.mjs <file.svg> --from 11.5 --to 13.6 --fps 5 [--width 1200] [--out dir]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { chromium } from "playwright";
import { contactSheet } from "@orrery/raster";
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : d; };
const optS = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
if (!file) { console.error("usage: node tools/browser-frames.mjs <file.svg> --from s --to s [--fps n] [--width px] [--out dir]"); process.exit(2); }
const from = opt("from", 0), to = opt("to", 4), fps = opt("fps", 5), width = opt("width", 1200);
const out = join(optS("out", ".orrery-inspect"), `${basename(file, ".svg")}-browser`);
mkdirSync(out, { recursive: true });
const [, w, h] = readFileSync(file, "utf8").match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).map(Number);
const height = Math.round((width * h) / w);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
// Wrap the SVG in a page so it renders as an image would (no script), sized to the viewport.
await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff"><img id="i" src="file://${resolve(file)}" style="display:block;width:${width}px;height:${height}px"></body></html>`);
// An <img> cannot be driven by WAAPI; use an inline copy instead, which browsers animate identically.
await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">${readFileSync(file, "utf8").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<svg /, `<svg style="display:block;width:${width}px;height:${height}px" `)}</body></html>`);
await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
const pngs = [];
for (let t = from, i = 0; t <= to + 1e-9; t += 1 / fps, i++) {
  await page.evaluate((ms) => document.getAnimations().forEach((a) => { a.currentTime = ms; }), Math.round(t * 1000));
  const png = await page.screenshot({ type: "png" });
  writeFileSync(join(out, `frame-${String(i).padStart(2, "0")}-${t.toFixed(2)}s.png`), png);
  pngs.push(png);
}
await browser.close();
writeFileSync(join(out, "sheet.png"), contactSheet(pngs, { columns: Math.min(4, pngs.length) }));
console.log(`${pngs.length} browser frames from ${from}s to ${to}s → ${out}/sheet.png`);
