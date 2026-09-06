/**
 * The regression suite's purpose is one file: examples/orrery.orrery.json, Orrery drawn in Orrery. It must use
 * every feature the model offers, so a feature added to the schema without a place in that diagram fails here,
 * and a feature that stops rendering there is noticed by the integration suite that draws it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONNECTION_KINDS, SHAPE_PRESETS, packNames, schema, validate, type Model } from "@orrery-diagrams/core";

const root = join(import.meta.dirname, "../..");
const raw: any = JSON.parse(readFileSync(join(root, "examples/orrery.orrery.json"), "utf8"));
const model: Model = (() => { const r = validate(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.model; })();

/** Every property path the schema offers, `*` for a keyed dictionary, array items flattened, every oneOf branch included. */
function schemaPaths(node: any, path: string, out: Set<string>): void {
  for (const [k, p] of Object.entries<any>(node.properties ?? {})) { if (k === "$schema") continue; out.add(`${path}/${k}`); schemaPaths(p, `${path}/${k}`, out); }
  if (node.items) schemaPaths(node.items, path, out);
  if (typeof node.additionalProperties === "object") schemaPaths(node.additionalProperties, `${path}/*`, out);
  for (const alt of node.oneOf ?? []) schemaPaths(alt, path, out);
}
const fits = (alt: any, v: unknown) => alt.type === "array" ? Array.isArray(v) : alt.type === "object" ? typeof v === "object" && v !== null && !Array.isArray(v) : alt.type ? typeof v === alt.type : true;
/** The property paths the file actually writes, walked with the schema alongside. */
function usedPaths(node: any, value: unknown, path: string, out: Set<string>): void {
  if (value === undefined || value === null) return;
  if (node.oneOf) { for (const alt of node.oneOf) if (fits(alt, value)) usedPaths(alt, value, path, out); return; }
  if (Array.isArray(value)) { if (node.items) for (const v of value) usedPaths(node.items, v, path, out); return; }
  if (typeof value !== "object") return;
  for (const [k, v] of Object.entries(value)) {
    if (node.properties?.[k]) { out.add(`${path}/${k}`); usedPaths(node.properties[k], v, `${path}/${k}`, out); }
    else if (typeof node.additionalProperties === "object") usedPaths(node.additionalProperties, v, `${path}/*`, out);
  }
}
/** Shorthands the diagram does not need because it writes the full form. Each needs a reason. */
const SHORTHANDS: Record<string, string> = {
  "/tour/views": "the tour writes scenes, of which views is the shorthand",
};

describe("Orrery drawn in Orrery: the schema", () => {
  it("every property the schema offers is written somewhere in the diagram of Orrery", () => {
    const offered = new Set<string>(), used = new Set<string>();
    schemaPaths(schema, "", offered);
    usedPaths(schema, raw, "", used);
    const missing = [...offered].filter((p) => !used.has(p) && !(p in SHORTHANDS)).sort();
    expect(missing, "add these to examples/orrery.orrery.json, or explain the shorthand").toEqual([]);
    for (const p of Object.keys(SHORTHANDS)) expect(offered.has(p), `${p} is no longer in the schema; drop it from SHORTHANDS`).toBe(true);
  });
});

describe("Orrery drawn in Orrery: the features", () => {
  const kindsUsed = new Set(model.components.map((c) => c.kind));
  const connKinds = new Set(model.connections.map((c) => c.kind));
  it("uses every pack, every default connection kind, its own kinds, shapes, states and lines", () => {
    for (const pack of packNames()) expect(pack === "sre" ? raw.states.use : raw.kinds.use, pack).toContain(pack);
    for (const k of Object.keys(DEFAULT_CONNECTION_KINDS)) expect(connKinds, k).toContain(k);
    expect([...connKinds].filter((k) => !(k in DEFAULT_CONNECTION_KINDS)).length).toBeGreaterThanOrEqual(2);
    expect([...kindsUsed].filter((k) => k.includes(":")).length).toBeGreaterThanOrEqual(3); // pack kinds drawn
    const shapes = new Set(Object.values(model.kinds.components).map((k) => k.shape).filter(Boolean));
    expect([...shapes].filter((s) => (SHAPE_PRESETS as readonly string[]).includes(s!)).length).toBeGreaterThanOrEqual(3);
    expect([...shapes].some((s) => model.shapes[s!]?.path !== undefined && !(SHAPE_PRESETS as readonly string[]).includes(s!))).toBe(true); // a shape of its own
    expect(Object.values(model.kinds.groups).some((g) => g.shape !== undefined)).toBe(true);
    expect(Object.values(model.kinds.components).some((k) => typeof k.glyph === "object")).toBe(true); // an inline icon
    expect(Object.values(model.kinds.components).some((k) => typeof k.glyph === "string" && k.glyph.startsWith("M"))).toBe(true); // path data
    expect(model.states.default).toBe("healthy");
    expect(Object.keys(model.states.define)).toEqual(expect.arrayContaining(["healthy", "impaired", "brownout", "outage", "drained", "planned"]));
  });
  it("nests closed groups two deep, and draws views that scope, restrict, close, turn and play", () => {
    const overview = model.views.find((v) => v.id === "overview")!;
    const packs = model.groups.find((g) => g.id === "packs")!;
    expect(overview.collapse).toEqual(expect.arrayContaining([packs.parent!, "packs"]));
    expect(model.views.some((v) => v.scope !== undefined)).toBe(true);
    expect(model.views.some((v) => v.only !== undefined)).toBe(true);
    expect(model.views.some((v) => v.direction !== model.direction)).toBe(true);
    expect(model.views.some((v) => v.play !== undefined)).toBe(true);
    expect(model.views.filter((v) => v.description !== undefined).length).toBeGreaterThanOrEqual(2);
    expect(model.description).toMatch(/every feature/);
  });
  it("tells stories: cumulative steps with reasons, restores, loads and callouts; a tour that opens, zooms, sets and narrates", () => {
    const steps = model.scenarios.flatMap((s) => s.steps);
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(steps.some((s) => Object.keys(s.reasons).length > 0)).toBe(true);
    expect(steps.some((s) => s.restore.length > 0)).toBe(true);
    expect(steps.some((s) => Object.values(s.load).includes(0))).toBe(true);
    expect(steps.filter((s) => s.callouts.length > 0).length).toBeGreaterThanOrEqual(2);
    expect(model.callouts.length).toBeGreaterThanOrEqual(1);
    const scenes = model.tour!.scenes;
    for (const field of ["open", "zoom", "scenario", "set", "callouts", "note"] as const) expect(scenes.some((s) => s[field] !== undefined), field).toBe(true);
    expect(scenes.some((s) => s.seconds !== model.tour!.seconds)).toBe(true);
  });
  it("exports every kind of picture", () => {
    const x = model.exports;
    const has = (pred: (e: (typeof x)[number]) => boolean, what: string) => expect(x.some(pred), what).toBe(true);
    has((e) => e.view === model.views[0]!.id && !e.open && !e.zoom && !e.scenario && !e.set && !e.play && !e.tour && !e.heading, "a plain still");
    has((e) => e.view !== model.views[0]!.id, "another view");
    has((e) => e.open !== undefined && e.zoom === undefined, "open without zoom");
    has((e) => e.zoom !== undefined && e.open === undefined, "zoom without open");
    has((e) => e.open !== undefined && e.zoom !== undefined, "open and zoom");
    has((e) => e.open !== undefined && e.open.length >= 2, "two levels open");
    has((e) => e.scenario !== undefined && e.step === 1, "a scenario step");
    has((e) => e.scenario !== undefined && e.step === 2, "a later step");
    has((e) => e.set !== undefined && (e.callouts?.length ?? 0) > 0, "a what-if with a callout");
    has((e) => e.play !== undefined, "play");
    has((e) => e.tour === true, "the tour");
    has((e) => e.heading === true, "a centred heading");
    has((e) => e.heading === "left", "a left heading");
  });
  it("draws the box details: replicas, tech lines, explicit states, meta, labels, bidirectional lines, groups with parents and states", () => {
    expect(model.components.some((c) => c.replicas > 1)).toBe(true);
    expect(model.components.filter((c) => c.tech !== undefined).length).toBeGreaterThanOrEqual(5);
    expect(model.components.some((c) => c.state !== model.states.default)).toBe(true);
    expect(model.components.some((c) => c.meta !== undefined)).toBe(true);
    expect(model.connections.some((c) => c.bidirectional)).toBe(true);
    expect(model.connections.some((c) => c.meta !== undefined)).toBe(true);
    expect(model.connections.filter((c) => c.label !== undefined).length).toBeGreaterThanOrEqual(5);
    expect(model.groups.some((g) => g.parent !== undefined && model.groups.find((p) => p.id === g.parent)!.parent !== undefined)).toBe(true);
    expect(model.groups.some((g) => g.meta !== undefined)).toBe(true);
  });
});
