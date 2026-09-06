/**
 * The performance ratchet (test/perf/README.md): the frozen benchmark model through every stage, measured, held
 * against baseline.json, which may only get better. Deterministic metrics are exact; timings have slack.
 */
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
const baselineFile = join(dir, "baseline.json");
type Metric = { value: number; unit: "ms" | "bytes" | "count" };
type Baseline = Record<string, Metric>;
const RATCHET = process.env.ORRERY_PERF_RATCHET === "1", RESET = process.env.ORRERY_PERF_RESET === "1";
const TIME_SLACK = process.env.CI ? 3 : 1.25;
const TIGHTEN = 0.02; // a deterministic gain beyond this must be locked in
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
    let baseline: Baseline | undefined;
    try { baseline = JSON.parse(readFileSync(baselineFile, "utf8")); } catch { baseline = undefined; }
    const lines: string[] = [], failures: string[] = [], gains: string[] = [];
    for (const [name, cur] of Object.entries(now)) {
      const base = baseline?.[name];
      const slack = cur.unit === "ms" ? TIME_SLACK : 1;
      const limit = base ? base.value * slack + (cur.unit === "ms" ? TIME_FLOOR_MS : 0) : Infinity;
      const verdict = !base ? "new" : cur.value > limit ? "SLOWER" : cur.unit !== "ms" && cur.value < base.value * (1 - TIGHTEN) ? "better, ratchet it" : "ok";
      lines.push(`${name.padEnd(width)}  ${String(cur.value).padStart(10)} ${cur.unit.padEnd(5)} baseline ${base ? String(base.value).padStart(10) : "         -"}  ${verdict}`);
      if (verdict === "SLOWER") failures.push(`${name}: ${cur.value} ${cur.unit} is worse than the baseline ${base!.value}${slack > 1 ? ` (×${slack} slack)` : ""}`);
      if (verdict === "better, ratchet it") gains.push(`${name}: ${cur.value} ${cur.unit}, baseline ${base!.value}; run yarn perf:ratchet to lock it in`);
    }
    console.log(`\n${lines.join("\n")}\n`);
    if (RATCHET) {
      const next: Baseline = {};
      for (const [name, cur] of Object.entries(now)) next[name] = RESET || !baseline?.[name] ? cur : { ...cur, value: Math.min(cur.value, baseline[name]!.value) };
      writeFileSync(baselineFile, JSON.stringify(next, null, 2) + "\n");
      console.log(`baseline ${RESET ? "reset" : "ratcheted"}: ${baselineFile}`);
      return;
    }
    expect(baseline, "no baseline: run yarn perf:ratchet once").toBeDefined();
    expect(failures, "performance regression").toEqual([]);
    expect(gains, "a gain is not a gain until the ratchet holds it").toEqual([]);
    for (const name of Object.keys(baseline!)) expect(now[name], `${name} is in the baseline but no longer measured`).toBeDefined();
  });
});
