// @vitest-environment jsdom
/**
 * Integration: the diagram of Orrery through the whole pipeline, in code rather than through the CLI. Every export
 * parses as XML and carries what its kind of picture must; the frame tooling freezes the animated ones; the
 * interactive file mounts in a DOM and the engine drives it: views, drill-down, scenarios, callouts, the tour.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDocument, renderExport, validate, type Model } from "@orrery-diagrams/core";
import { ElkLayoutEngine } from "@orrery-diagrams/layout-elk";
import { activeView, freezeFrame } from "@orrery-diagrams/raster";
import { mount, type Orrery } from "../../packages/runtime/src/browser/index.js";

const root = join(import.meta.dirname, "../..");
const model: Model = (() => { const r = validate(JSON.parse(readFileSync(join(root, "examples/orrery.orrery.json"), "utf8"))); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.model; })();
const engine = () => new ElkLayoutEngine();
const exported = new Map<string, string>();
const pictureOf = async (id: string) => { if (!exported.has(id)) exported.set(id, await renderExport(model, engine(), model.exports.find((x) => x.id === id)!)); return exported.get(id)!; };
const parses = (svg: string) => { const d = new DOMParser().parseFromString(svg, "image/svg+xml"); return d.querySelector("parsererror") === null; };

describe("integration: every export of the diagram of Orrery", () => {
  it("is well-formed XML", async () => {
    for (const x of model.exports) expect(parses(await pictureOf(x.id)), x.id).toBe(true);
  }, 120_000);
  it("carries what its kind of picture must", async () => {
    expect(await pictureOf("open-packs")).toMatch(/data-open="vocabulary packs"/);
    const [, w] = (await pictureOf("zoom-renderer")).match(/viewBox="[\d.]+ [\d.]+ ([\d.]+)/)!;
    const [, full] = (await pictureOf("overview")).match(/viewBox="0 0 ([\d.]+)/)!;
    expect(Number(w)).toBeLessThan(Number(full) / 2); // cropped to one box
    const step = await pictureOf("invalid-1");
    expect(step).toContain('data-callout="validate"'); // the step's note
    expect(step).toContain('data-callout="model"'); // the standing one
    expect(step).toMatch(/data-node="model"[^>]*data-state="outage"/);
    expect(step).toContain('class="legend"');
    expect(await pictureOf("what-if")).toContain('data-callout="png"');
    expect(await pictureOf("heading")).toContain('class="heading-title centred"');
    expect(await pictureOf("heading-left")).toContain('<text class="heading-title" x="20"');
    expect((await pictureOf("out")).match(/<g class="step" data-step=/g)).toHaveLength(3); // base plus two steps
    const tour = await pictureOf("tour");
    expect(tour).toContain("@keyframes orrery-camera");
    expect(tour).toMatch(/orrery-callouts-\d/);
    expect(tour).toMatch(/orrery-size-vocabulary/); // a closed box that opens into a frame
  }, 120_000);
  it("freezes at any moment: the tour's first scene is the still, later scenes differ", async () => {
    const tour = await pictureOf("tour");
    const t0 = freezeFrame(tour, 0), later = freezeFrame(tour, 9000);
    expect(t0).not.toBe(later);
    const still = activeView(tour); // the first scene alone: its caption stays, the second scene's goes
    expect(still).toContain("One file in, pictures out");
    expect(still).not.toContain("Packs, two levels down");
    expect(still).not.toMatch(/data-t0="0"/);
  }, 60_000);
});

describe("integration: the interactive file, driven by the engine", () => {
  let rt: Orrery;
  afterEach(() => { rt?.destroy(); vi.useRealTimers(); });
  const shownLayer = (root: Element) => [...root.querySelectorAll<SVGGElement>(".view")].find((g) => g.style.display !== "none")!;
  it("mounts, switches views, opens two levels, zooms, steps a scenario with its callouts, plays the tour", async () => {
    const svg = await renderDocument(model, engine(), { runtime: "", heading: true }); // ELK schedules with timers: lay out before faking them
    vi.useFakeTimers();
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    const walker = parsed.createTreeWalker(parsed, 8);
    const cdata: Node[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) cdata.push(n);
    for (const n of cdata) n.parentNode!.replaceChild(parsed.createTextNode(n.textContent ?? ""), n);
    const root = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
    document.body.innerHTML = ""; document.body.appendChild(root);
    rt = mount(root, { size: { width: 1600, height: 900 } });
    rt.stop();
    expect(rt.views.map((v) => v.id)).toEqual(["overview", "core", "author", "out"]);
    expect(rt.scenarios.map((s) => s.id)).toEqual(["invalid-model", "swap-engine"]);
    expect(rt.groups().filter((g) => g.closable).map((g) => g.id)).toEqual(["icon-sets", "vocabulary", "runtime"]); // packs is inside the closed vocabulary
    expect(rt.open(["packs"])).toBe(false); // its closed parent must be open too
    expect(rt.open(["vocabulary", "packs"])).toBe(true);
    vi.advanceTimersByTime(900);
    expect(shownLayer(root).getAttribute("data-open")).toBe("vocabulary packs");
    expect(shownLayer(root).querySelector('[data-node="aws-pack"]')).not.toBeNull();
    expect(rt.groups().filter((g) => g.closable && g.open).map((g) => g.id)).toEqual(["vocabulary", "packs"]);
    rt.zoom("packs");
    vi.advanceTimersByTime(400);
    expect(rt.snapshot().zoom).toBe("packs");
    expect(rt.back()).toBe(true); // zoom out first
    expect(rt.snapshot().zoom).toBeNull();
    rt.setScenario("invalid-model", 1);
    expect(rt.snapshot().states.model).toMatchObject({ state: "outage", reason: expect.stringContaining("grpc") });
    const shownSteps = () => [...root.querySelectorAll<SVGGElement>(".callouts-step")].filter((g) => g.style.display !== "none").map((g) => `${g.getAttribute("data-scenario")}/${g.getAttribute("data-step")}`);
    expect(new Set(shownSteps())).toEqual(new Set(["invalid-model/1"]));
    rt.next();
    expect(rt.snapshot().states.model!.state).toBe("healthy");
    expect(new Set(shownSteps())).toEqual(new Set(["invalid-model/2"]));
    rt.reset(); // closes the open groups with a morph; the moment's callouts go with the old layout
    vi.advanceTimersByTime(900);
    expect(shownSteps()).toEqual([]);
    expect(shownLayer(root).getAttribute("data-open")).toBe("");
    rt.showView("core");
    vi.advanceTimersByTime(900);
    expect(shownLayer(root).getAttribute("data-view")).toBe("core");
    rt.play();
    vi.advanceTimersByTime(4500); // into the second scene of the tour
    expect(rt.snapshot().playing).toBe(true);
    expect(shownLayer(root).getAttribute("data-open")).toBe("vocabulary");
    rt.stop();
    expect(rt.snapshot().playing).toBe(false);
  }, 120_000);
});
