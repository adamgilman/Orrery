/**
 * The performance ratchet (test/perf/README.md): the frozen benchmark model through every stage, measured, held
 * against a baseline that may only get better. The baseline is baseline.json on the perf-baseline branch, measured
 * and tightened by CI on every push to main; nobody edits it. Deterministic metrics are exact; timings have slack.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { declare, renderDocument, renderExport, renderSvg, scopeModel, stopFlows, toLayoutGraph, validate, type LayoutEngine, type LayoutGraph, type LayoutResult, type Model } from "@orrery-diagrams/core";
import { ElkLayoutEngine } from "@orrery-diagrams/layout-elk";
import { freezeFrame } from "@orrery-diagrams/raster";

const dir = import.meta.dirname;
const root = join(dir, "../..");
const raw = JSON.parse(readFileSync(join(dir, "benchmark.orrery.json"), "utf8"));
type Metric = { value: number; unit: "ms" | "bytes" | "count" };
type Baseline = Record<string, Metric>;
/** check: hold the line (a pull request, a push). ratchet: write the tightened baseline to ratchet.json for CI to store. */
const MODE = process.env.ORRERY_PERF_MODE === "ratchet" ? "ratchet" : "check";
/** Metrics a pull request declares it grows on purpose (`perf-accept: a, b` in its body, with the reason): not a regression, and the ratchet resets them to what was measured. */
const ACCEPT = new Set((process.env.ORRERY_PERF_ACCEPT ?? "").split(/[,\s]+/).filter(Boolean));
/** The baseline as CI measured it: passed in by the workflow, or fetched from the perf-baseline branch for a local run. */
function loadBaseline(): Baseline | undefined {
  const given = process.env.ORRERY_PERF_BASELINE_JSON;
  if (given !== undefined) return given.trim() ? JSON.parse(given) : undefined;
  const r = spawnSync("gh", ["api", "-H", "Accept: application/vnd.github.raw", "repos/adamgilman/Orrery/contents/baseline.json?ref=perf-baseline"], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim().startsWith("{") ? JSON.parse(r.stdout) : undefined;
}
// CI measures on one machine class, so it holds timings tighter than a laptop compared against CI's numbers must.
const TIME_SLACK = process.env.CI ? 1.6 : 2;
const TIGHTEN = 0.02; // a gain smaller than this is noise, not a gain
const TIME_FLOOR_MS = 2; // jitter on a sub-millisecond median is not a regression

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
async function timed(runs: number, fn: () => Promise<unknown> | unknown): Promise<number> {
  const xs: number[] = [];
  for (let i = 0; i < runs; i++) { const t = performance.now(); await fn(); xs.push(performance.now() - t); }
  return Math.round(median(xs) * 100) / 100;
}
/** An engine that counts its calls, so the document's layout work is a number the ratchet can hold. */
class Counting implements LayoutEngine { calls = 0; private readonly inner = new ElkLayoutEngine(); layout(g: LayoutGraph): Promise<LayoutResult> { this.calls++; return this.inner.layout(g); } }

async function measure(): Promise<Baseline> {
  const m: Baseline = {};
  m["validate.ms"] = { value: await timed(20, () => validate(raw)), unit: "ms" };
  const model: Model = (validate(raw) as { model: Model }).model;
  const overview = scopeModel(stopFlows(declare(model).model), model.views[0]!);
  const engine = new ElkLayoutEngine();
  m["layout.ms"] = { value: await timed(5, () => engine.layout(toLayoutGraph(overview))), unit: "ms" };
  const layout = await engine.layout(toLayoutGraph(overview));
  m["render.ms"] = { value: await timed(20, () => renderSvg(overview, layout)), unit: "ms" };
  m["overview.bytes"] = { value: Buffer.byteLength(renderSvg(overview, layout)), unit: "bytes" };
  const counting = new Counting();
  const doc = await renderDocument(model, counting, { runtime: readFileSync(join(root, "packages/runtime/dist/runtime.min.js"), "utf8") });
  m["document.ms"] = { value: await timed(3, () => renderDocument(model, new ElkLayoutEngine(), { runtime: "" })), unit: "ms" };
  m["document.bytes"] = { value: Buffer.byteLength(doc), unit: "bytes" };
  m["document.layers"] = { value: (doc.match(/<g class="view"/g) ?? []).length, unit: "count" };
  m["document.layouts"] = { value: counting.calls, unit: "count" };
  const tour = await renderExport(model, engine, model.exports.find((x) => x.tour)!);
  m["tour.ms"] = { value: await timed(3, () => renderExport(model, new ElkLayoutEngine(), model.exports.find((x) => x.tour)!)), unit: "ms" };
  m["tour.bytes"] = { value: Buffer.byteLength(tour), unit: "bytes" };
  m["play.bytes"] = { value: Buffer.byteLength(await renderExport(model, engine, model.exports.find((x) => x.play)!)), unit: "bytes" };
  m["freeze.ms"] = { value: await timed(5, () => freezeFrame(tour, 6000)), unit: "ms" };
  m["runtime.bytes"] = { value: statSync(join(root, "packages/runtime/dist/runtime.min.js")).size, unit: "bytes" };
  return m;
}

describe("performance ratchet", () => {
  it("holds every metric of the frozen benchmark at or below the baseline", { timeout: 600_000 }, async () => {
    const now = await measure();
    const width = Math.max(...Object.keys(now).map((k) => k.length));
    const baseline = loadBaseline();
    const lines: string[] = [], failures: string[] = [], gains: string[] = [];
    for (const [name, cur] of Object.entries(now)) {
      const base = baseline?.[name];
      const slack = cur.unit === "ms" ? TIME_SLACK : 1;
      const limit = base ? base.value * slack + (cur.unit === "ms" ? TIME_FLOOR_MS : 0) : Infinity;
      const verdict = !base ? "new" : cur.value > limit ? (ACCEPT.has(name) ? "accepted growth" : "SLOWER") : cur.value < base.value * (1 - TIGHTEN) ? "better" : "ok";
      lines.push(`${name.padEnd(width)}  ${String(cur.value).padStart(10)} ${cur.unit.padEnd(5)} baseline ${base ? String(base.value).padStart(10) : "         -"}  ${verdict}`);
      if (verdict === "SLOWER") failures.push(`${name}: ${cur.value} ${cur.unit} is worse than the baseline ${base!.value}${slack > 1 ? ` (×${slack} slack)` : ""}`);
      if (verdict === "better") gains.push(`${name}: ${cur.value} ${cur.unit}, baseline ${base!.value}`);
    }
    const table = lines.join("\n");
    console.log(`\n${table}\n`);
    writeFileSync(join(dir, "last.md"), `| metric | measured | baseline | |\n|---|---:|---:|---|\n${Object.entries(now).map(([name, cur]) => `| ${name} | ${cur.value} ${cur.unit} | ${baseline?.[name]?.value ?? "-"} | ${lines.find((l) => l.startsWith(name))!.split("  ").at(-1)} |`).join("\n")}\n`);
    if (MODE === "ratchet") {
      // the tightened baseline: every metric at its best ever; a metric the baseline no longer knows is dropped
      const next: Baseline = {};
      for (const [name, cur] of Object.entries(now)) next[name] = baseline?.[name] && !ACCEPT.has(name) ? { ...cur, value: Math.min(cur.value, baseline[name]!.value) } : cur;
      writeFileSync(join(dir, "ratchet.json"), JSON.stringify(next));
      console.log(`ratchet: ${gains.length ? gains.join("; ") : "nothing tightened"}`);
      return;
    }
    if (!baseline) { console.log("no baseline yet: CI writes the perf-baseline branch on the next push to main"); return; }
    expect(failures, "performance regression against the baseline CI measured").toEqual([]);
  });
});
