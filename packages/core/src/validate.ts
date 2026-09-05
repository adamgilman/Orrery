import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv, type ErrorObject } from "ajv";
import { DEFAULT_COMPONENT_KINDS, DEFAULT_CONNECTION_KINDS, DEFAULT_GROUP_KINDS, DEFAULT_STATE, DEFAULT_STATES, FRAME_PRESETS, GLYPH_PRESETS, LINE_PRESETS, NEW_STATE_DEFAULTS } from "./defaults.js";
import { CSS_COLOR } from "./looks.js";
import type { Component, ComponentKindDef, Connection, ConnectionKindDef, Direction, Group, GroupKindDef, Kinds, LookPreset, LookStyle, Model, Scenario, ScenarioStep, Scene, StateDef, States, Tour, View } from "./types.js";

export class ValidationError extends Error {
  constructor(public readonly pointer: string, message: string) { super(message); }
  override toString(): string { return `${this.pointer}: ${this.message}`; }
}
export class ValidationWarning extends ValidationError {}

export type ValidationResult =
  | { ok: true; model: Model; warnings: ValidationWarning[] }
  | { ok: false; errors: ValidationError[] };

export const schema: object = JSON.parse(readFileSync(join(import.meta.dirname, "../schema/v1.json"), "utf8"));
const ajv = new Ajv({ allErrors: true, useDefaults: true, strict: true });
const checkSchema = ajv.compile(schema);

const article = (t: string) => (/^[aeiou]/.test(t) ? `an ${t}` : `a ${t}`);
function describe(e: ErrorObject): ValidationError {
  const p = e.params as Record<string, unknown>;
  switch (e.keyword) {
    case "additionalProperties": return new ValidationError(e.instancePath, `unknown property "${String(p.additionalProperty)}"`);
    case "required": return new ValidationError(e.instancePath, `missing required property "${String(p.missingProperty)}"`);
    case "enum": return new ValidationError(e.instancePath, `must be one of: ${(p.allowedValues as unknown[]).join(", ")}`);
    case "type": return new ValidationError(e.instancePath, `must be ${article(String(p.type))}`);
    case "oneOf": return new ValidationError(e.instancePath, "does not match any allowed form");
    default: return new ValidationError(e.instancePath, e.message ?? e.keyword);
  }
}
/**
 * A failed oneOf reports every branch's complaints. Keep the complaints of the branch whose shape matches the
 * instance (string vs object/array), so "min must be >= 1" survives instead of "does not match any allowed form".
 */
function pickOneOfBranch(all: ErrorObject[], data: unknown): ErrorObject[] {
  const at = (pointer: string): unknown => pointer.split("/").slice(1).reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k.replace(/~1/g, "/").replace(/~0/g, "~")], data);
  const oneOfs = all.filter((e) => e.keyword === "oneOf");
  let kept = all;
  for (const o of oneOfs) {
    const branch = typeof at(o.instancePath) === "string" ? 0 : 1;
    const inside = (e: ErrorObject) => e !== o && (e.instancePath === o.instancePath || e.instancePath.startsWith(o.instancePath + "/"));
    const matching = kept.filter((e) => inside(e) && e.schemaPath.includes(`/oneOf/${branch}/`));
    kept = matching.length ? kept.filter((e) => !inside(e) && e !== o).concat(matching) : kept.filter((e) => !inside(e));
  }
  return kept;
}
const dedupe = (errors: ValidationError[]) => { const seen = new Set<string>(); return errors.filter((e) => { const k = e.toString(); if (seen.has(k)) return false; seen.add(k); return true; }); };
const opt = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } => (value !== undefined ? ({ [key]: value } as { [P in K]: V }) : {});
const list = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
/** A `set` entry: one id, a list of ids, or ids with reasons. */
type SetEntry = string | string[] | Record<string, string>;
const idsOf = (v: SetEntry): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v : Object.keys(v));
const reasonsOf = (v: SetEntry): Record<string, string> => (typeof v === "object" && !Array.isArray(v) ? v : {});

/* ---------- raw shapes (after schema defaults) ---------- */
interface RawStateDef { look?: LookPreset | LookStyle; flows?: "keep" | "stop"; description?: string }
interface Raw {
  title?: string; direction: Direction;
  states?: { default?: string; replace?: boolean; define?: Record<string, RawStateDef> };
  kinds?: { replace?: boolean; components?: Record<string, ComponentKindDef>; groups?: Record<string, GroupKindDef>; connections?: Record<string, ConnectionKindDef> };
  components: { id: string; label?: string; kind: string; group?: string; state?: string; replicas: number; tech?: string; description?: string; meta?: Record<string, unknown> }[];
  connections: { from: string; to: string; id?: string; kind: string; label?: string; load: number; bidirectional: boolean; meta?: Record<string, unknown> }[];
  groups: { id: string; label?: string; kind: string; parent?: string; state?: string; description?: string; meta?: Record<string, unknown> }[];
  views?: { id: string; title?: string; type: "topology"; direction?: Direction; scope?: string; only?: string[]; play?: { scenario: string; seconds: number }; collapse?: string[] }[];
  scenarios: { id: string; label?: string; steps: { note?: string; set?: Record<string, SetEntry>; restore?: string | string[]; load?: { from?: string; to?: string; id?: string; load: number }[] }[] }[];
  tour?: { seconds: number; views?: string[]; scenes?: { view: string; focus?: string; scenario?: string; step?: number; set?: Record<string, SetEntry>; note?: string; seconds?: number }[] };
}

/* ---------- vocabulary ---------- */
function buildStates(raw: Raw["states"], given: Raw["states"], err: (p: string, m: string) => void): States {
  const define: Record<string, StateDef> = Object.create(null);
  if (!raw?.replace) for (const [name, d] of Object.entries(DEFAULT_STATES)) define[name] = { name, ...d };
  for (const [name, user] of Object.entries(raw?.define ?? {})) {
    const base = define[name] ?? { name, ...NEW_STATE_DEFAULTS };
    define[name] = { ...base, ...user, name };
    const look = user.look;
    if (look && typeof look === "object") for (const k of ["stroke", "fill", "text"] as const) if (look[k] !== undefined && !CSS_COLOR.test(look[k]!)) err(`/states/define/${name}/look/${k}`, `"${look[k]}" is not a CSS colour`);
  }
  const def = raw?.default ?? DEFAULT_STATE;
  if (!Object.hasOwn(define, def)) err("/states/default", raw?.replace && given?.default === undefined ? `states.replace is true, so states.default must name one of: ${Object.keys(define).join(", ")}` : `unknown state "${def}"; known: ${Object.keys(define).join(", ")}`);
  return { default: def, define };
}

function buildKinds(raw: Raw["kinds"], err: (p: string, m: string) => void): Kinds {
  const components: Record<string, ComponentKindDef> = Object.assign(Object.create(null), raw?.replace ? {} : DEFAULT_COMPONENT_KINDS);
  const groups: Record<string, GroupKindDef> = Object.assign(Object.create(null), raw?.replace ? {} : DEFAULT_GROUP_KINDS);
  const connections: Record<string, ConnectionKindDef> = Object.assign(Object.create(null), raw?.replace ? {} : DEFAULT_CONNECTION_KINDS);
  const colour = (p: string, v: string | undefined) => { if (v !== undefined && !CSS_COLOR.test(v)) err(p, `"${v}" is not a CSS colour`); };
  for (const [name, k] of Object.entries(raw?.components ?? {})) {
    components[name] = { ...(components[name] ?? {}), ...k };
    colour(`/kinds/components/${name}/box/fill`, k.box?.fill); colour(`/kinds/components/${name}/box/stroke`, k.box?.stroke);
    if (k.glyph !== undefined && !(GLYPH_PRESETS as readonly string[]).includes(k.glyph) && !/^[Mm][\d\s.,+a-zA-Z-]+$/.test(k.glyph))
      err(`/kinds/components/${name}/glyph`, `must be a preset glyph (${GLYPH_PRESETS.join(", ")}) or SVG path data starting with M`);
  }
  for (const [name, k] of Object.entries(raw?.groups ?? {})) {
    groups[name] = { ...(groups[name] ?? { frame: "tier" }), ...k };
    if (typeof k.frame === "string" && !(FRAME_PRESETS as readonly string[]).includes(k.frame)) err(`/kinds/groups/${name}/frame`, `must be one of: ${FRAME_PRESETS.join(", ")}`);
    if (typeof k.frame === "object") { colour(`/kinds/groups/${name}/frame/stroke`, k.frame.stroke); colour(`/kinds/groups/${name}/frame/fill`, k.frame.fill); }
  }
  for (const [name, k] of Object.entries(raw?.connections ?? {})) {
    connections[name] = { ...(connections[name] ?? { line: "solid" }), ...k };
    if (typeof k.line === "string" && !(LINE_PRESETS as readonly string[]).includes(k.line)) err(`/kinds/connections/${name}/line`, `must be one of: ${LINE_PRESETS.join(", ")}`);
    if (typeof k.line === "object") { colour(`/kinds/connections/${name}/line/stroke`, k.line.stroke); colour(`/kinds/connections/${name}/line/flow`, k.line.flow); }
  }
  return { components, groups, connections };
}

/* ---------- main ---------- */
export function validate(input: unknown): ValidationResult {
  const data: unknown = structuredClone(input);
  if (!checkSchema(data)) return { ok: false, errors: dedupe(pickOneOfBranch(checkSchema.errors ?? [], data).map(describe)) };
  const raw = data as Raw;
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const err = (p: string, m: string) => errors.push(new ValidationError(p, m));

  // Schema defaults have filled `raw`; the untouched input says what the author actually wrote.
  const states = buildStates(raw.states, (input as Raw | undefined)?.states, err);
  const kinds = buildKinds(raw.kinds, err);
  const stateOk = (name: string) => Object.hasOwn(states.define, name);
  const componentKindOk = (name: string) => Object.hasOwn(kinds.components, name);
  const groupKindOk = (name: string) => Object.hasOwn(kinds.groups, name);
  const connectionKindOk = (name: string) => Object.hasOwn(kinds.connections, name);

  /* ids and references */
  const groupIds = new Set<string>();
  raw.groups.forEach((g, i) => { if (groupIds.has(g.id)) err(`/groups/${i}/id`, `duplicate group id "${g.id}"`); groupIds.add(g.id); });
  const componentIds = new Set<string>();
  raw.components.forEach((c, i) => {
    if (componentIds.has(c.id)) err(`/components/${i}/id`, `duplicate component id "${c.id}"`);
    else if (groupIds.has(c.id)) err(`/components/${i}/id`, `id "${c.id}" is already used by a group`);
    componentIds.add(c.id);
  });
  const isEntity = (id: string) => componentIds.has(id) || groupIds.has(id);
  const parentOf = new Map(raw.groups.map((g) => [g.id, g.parent] as const));
  const groupOfComponent = new Map(raw.components.map((c) => [c.id, c.group] as const));
  const ancestors = (id: string): string[] => {
    const out: string[] = [];
    for (let cur = componentIds.has(id) ? groupOfComponent.get(id) : parentOf.get(id); cur !== undefined && !out.includes(cur); cur = parentOf.get(cur)) out.push(cur);
    return out;
  };

  raw.groups.forEach((g, i) => {
    if (!groupKindOk(g.kind)) err(`/groups/${i}/kind`, `unknown group kind "${g.kind}"; known: ${Object.keys(kinds.groups).join(", ")}`);
    if (g.state !== undefined && !stateOk(g.state)) err(`/groups/${i}/state`, `unknown state "${g.state}"; known: ${Object.keys(states.define).join(", ")}`);
    if (g.parent === undefined) return;
    if (!groupIds.has(g.parent)) return err(`/groups/${i}/parent`, `unknown group "${g.parent}"`);
    const seen = new Set<string>([g.id]);
    for (let cur: string | undefined = g.parent; cur !== undefined; cur = parentOf.get(cur)) {
      if (cur === g.id) return err(`/groups/${i}/parent`, `group cycle through "${g.id}"`);
      if (seen.has(cur)) return;
      seen.add(cur);
    }
  });
  raw.components.forEach((c, i) => {
    if (!componentKindOk(c.kind)) err(`/components/${i}/kind`, `unknown component kind "${c.kind}"; known: ${Object.keys(kinds.components).join(", ")}`);
    if (c.state !== undefined && !stateOk(c.state)) err(`/components/${i}/state`, `unknown state "${c.state}"; known: ${Object.keys(states.define).join(", ")}`);
    if (c.group !== undefined && !groupIds.has(c.group)) err(`/components/${i}/group`, `unknown group "${c.group}"`);
  });

  /* connections */
  const pairCount = new Map<string, number>();
  for (const c of raw.connections) pairCount.set(`${c.from}->${c.to}`, (pairCount.get(`${c.from}->${c.to}`) ?? 0) + 1);
  const connectionKeys = new Set<string>();
  const connections: Connection[] = [];
  raw.connections.forEach((c, i) => {
    if (!connectionKindOk(c.kind)) err(`/connections/${i}/kind`, `unknown connection kind "${c.kind}"; known: ${Object.keys(kinds.connections).join(", ")}`);
    if (!isEntity(c.from)) err(`/connections/${i}/from`, `unknown entity "${c.from}"`);
    if (!isEntity(c.to)) err(`/connections/${i}/to`, `unknown entity "${c.to}"`);
    if (isEntity(c.from) && isEntity(c.to)) {
      if (c.from === c.to) err(`/connections/${i}`, `connection from "${c.from}" to itself`);
      else if (ancestors(c.from).includes(c.to) || ancestors(c.to).includes(c.from)) err(`/connections/${i}`, `"${c.from}" and "${c.to}" contain one another; a connection between an entity and its own group says nothing`);
    }
    const parallel = (pairCount.get(`${c.from}->${c.to}`) ?? 0) > 1;
    if (parallel && c.id === undefined) err(`/connections/${i}`, `"${c.from}" has several connections to "${c.to}"; give each an id`);
    const key = c.id ?? `${c.from}->${c.to}`;
    if (c.id !== undefined && connectionKeys.has(key)) err(`/connections/${i}/id`, `duplicate connection id "${key}"`);
    connectionKeys.add(key);
    connections.push({ key, from: c.from, to: c.to, kind: c.kind, load: c.load, bidirectional: c.bidirectional, ...opt("id", c.id), ...opt("label", c.label), ...opt("meta", c.meta) });
  });
  // W1: an entity connected both to a group and to something inside it, in either direction.
  connections.forEach((c, i) => {
    for (const anc of ancestors(c.to)) if (connections.some((o) => o.from === c.from && o.to === anc)) warnings.push(new ValidationWarning(`/connections/${i}`, `"${c.from}" connects to "${c.to}" and also to its group "${anc}"; both lines will be drawn`));
    for (const anc of ancestors(c.from)) if (connections.some((o) => o.to === c.to && o.from === anc)) warnings.push(new ValidationWarning(`/connections/${i}`, `"${c.from}" connects to "${c.to}" and so does its group "${anc}"; both lines will be drawn`));
  });

  const components: Component[] = raw.components.map((c) => ({ id: c.id, label: c.label ?? c.id, kind: c.kind, state: c.state ?? states.default, replicas: c.replicas, ...opt("group", c.group), ...opt("tech", c.tech), ...opt("description", c.description), ...opt("meta", c.meta) }));
  const groups: Group[] = raw.groups.map((g) => ({ id: g.id, label: g.label ?? g.id, kind: g.kind, state: g.state ?? states.default, ...opt("parent", g.parent), ...opt("description", g.description), ...opt("meta", g.meta) }));

  /* views */
  const viewIds = new Set<string>();
  const views: View[] = (raw.views ?? [{ id: "default", type: "topology" }]).map((v, i) => {
    if (viewIds.has(v.id)) err(`/views/${i}/id`, `duplicate view id "${v.id}"`);
    viewIds.add(v.id);
    if (v.scope !== undefined && !groupIds.has(v.scope)) err(`/views/${i}/scope`, `unknown group "${v.scope}"`);
    v.only?.forEach((id, k) => {
      if (!isEntity(id)) return err(`/views/${i}/only/${k}`, `unknown entity "${id}"`);
      if (v.scope !== undefined && groupIds.has(v.scope) && id !== v.scope && !ancestors(id).includes(v.scope)) err(`/views/${i}/only/${k}`, `"${id}" is not inside scope "${v.scope}"`);
    });
    if (v.play && !raw.scenarios.some((sc) => sc.id === v.play!.scenario)) err(`/views/${i}/play/scenario`, `unknown scenario "${v.play.scenario}"`);
    v.collapse?.forEach((id, k) => {
      if (componentIds.has(id)) return err(`/views/${i}/collapse/${k}`, `"${id}" is not a group`);
      if (!groupIds.has(id)) return err(`/views/${i}/collapse/${k}`, `unknown group "${id}"`);
      if (v.scope !== undefined && groupIds.has(v.scope) && id !== v.scope && !ancestors(id).includes(v.scope)) err(`/views/${i}/collapse/${k}`, `"${id}" is not inside scope "${v.scope}"`);
    });
    return { id: v.id, type: v.type, direction: v.direction ?? raw.direction, ...opt("title", v.title), ...opt("scope", v.scope), ...opt("only", v.only), ...opt("play", v.play), ...opt("collapse", v.collapse) };
  });

  /* scenarios */
  const scenarioIds = new Set<string>();
  const scenarios: Scenario[] = raw.scenarios.map((sc, i) => {
    if (scenarioIds.has(sc.id)) err(`/scenarios/${i}/id`, `duplicate scenario id "${sc.id}"`);
    scenarioIds.add(sc.id);
    const steps: ScenarioStep[] = sc.steps.map((st, j) => {
      const base = `/scenarios/${i}/steps/${j}`;
      const seen = new Map<string, string>();
      const set: Record<string, string[]> = Object.create(null);
      const reasons: Record<string, string> = Object.create(null);
      for (const [state, entry] of Object.entries(st.set ?? {})) {
        if (!stateOk(state)) err(`${base}/set/${state}`, `unknown state "${state}"; known: ${Object.keys(states.define).join(", ")}`);
        set[state] = idsOf(entry);
        Object.assign(reasons, reasonsOf(entry));
        set[state]!.forEach((id, k) => {
          const p = Array.isArray(entry) ? `${base}/set/${state}/${k}` : typeof entry === "string" ? `${base}/set/${state}` : `${base}/set/${state}/${id}`;
          if (!isEntity(id)) err(p, `unknown entity "${id}"`);
          if (seen.has(id)) err(p, `"${id}" is already set to "${seen.get(id)}" in this step`);
          seen.set(id, state);
        });
      }
      const restore = list(st.restore);
      for (const id of restore) {
        if (!isEntity(id)) err(`${base}/restore`, `unknown entity "${id}"`);
        if (seen.has(id)) err(`${base}/restore`, `"${id}" is both set and restored in this step`);
        seen.set(id, "restore");
      }
      const load: Record<string, number> = {};
      (st.load ?? []).forEach((l, k) => {
        const p = `${base}/load/${k}`;
        let key: string | undefined;
        if (l.id !== undefined && (l.from !== undefined || l.to !== undefined)) err(p, "give from and to, or id, not both");
        else if (l.id !== undefined) { if (!connectionKeys.has(l.id)) err(p, `unknown connection id "${l.id}"`); else key = l.id; }
        else if (l.from !== undefined && l.to !== undefined) {
          const matches = connections.filter((c) => c.from === l.from && c.to === l.to);
          if (matches.length === 0) err(p, `no connection from "${l.from}" to "${l.to}"`);
          else if (matches.length > 1) err(p, `"${l.from}" has several connections to "${l.to}"; refer to one by id`);
          else key = matches[0]!.key;
        } else err(p, "give from and to, or id");
        if (key !== undefined) load[key] = l.load;
      });
      if (Object.keys(set).length + restore.length + (st.load ?? []).length === 0) err(base, "step changes nothing");
      return { ...opt("note", st.note), set, reasons, restore, load };
    });
    return { id: sc.id, label: sc.label ?? sc.id, steps };
  });

  /* tour: a plain list of views, or scenes */
  let tour: Tour | undefined;
  if (raw.tour) {
    const t = raw.tour;
    if (!t.views && !t.scenes) err("/tour", "give views or scenes");
    t.views?.forEach((id, k) => { if (!viewIds.has(id)) err(`/tour/views/${k}`, `unknown view "${id}"`); });
    type RawScene = { view: string; focus?: string; scenario?: string; step?: number; set?: Record<string, SetEntry>; note?: string; seconds?: number };
    const rawScenes: RawScene[] = t.scenes ?? (t.views ?? []).map((view) => ({ view }));
    const scenes: Scene[] = rawScenes.map((sc, k) => {
      const base = t.scenes ? `/tour/scenes/${k}` : `/tour/views/${k}`;
      if (t.scenes && !viewIds.has(sc.view)) err(`${base}/view`, `unknown view "${sc.view}"`);
      if (sc.focus !== undefined) {
        if (componentIds.has(sc.focus)) err(`${base}/focus`, `"${sc.focus}" is not a group`);
        else if (!groupIds.has(sc.focus)) err(`${base}/focus`, `unknown group "${sc.focus}"`);
      }
      const scenario = sc.scenario !== undefined ? scenarios.find((x) => x.id === sc.scenario) : undefined;
      if (sc.scenario !== undefined && !scenario) err(`${base}/scenario`, `unknown scenario "${sc.scenario}"`);
      if (sc.step !== undefined && scenario && (sc.step < 1 || sc.step > scenario.steps.length)) err(`${base}/step`, `step must be between 1 and ${scenario.steps.length}`);
      if (sc.step !== undefined && sc.scenario === undefined) err(`${base}/step`, "step needs a scenario");
      const set: Record<string, string[]> = Object.create(null);
      const reasons: Record<string, string> = Object.create(null);
      for (const [state, entry] of Object.entries(sc.set ?? {})) {
        if (!stateOk(state)) err(`${base}/set/${state}`, `unknown state "${state}"; known: ${Object.keys(states.define).join(", ")}`);
        set[state] = idsOf(entry);
        Object.assign(reasons, reasonsOf(entry));
        for (const id of set[state]!) if (!isEntity(id)) err(`${base}/set/${state}`, `unknown entity "${id}"`);
      }
      return { view: sc.view, seconds: sc.seconds ?? t.seconds, ...opt("focus", sc.focus), ...opt("scenario", sc.scenario), ...opt("step", sc.step), ...(sc.set ? { set } : {}), ...(Object.keys(reasons).length ? { reasons } : {}), ...opt("note", sc.note) };
    });
    tour = { seconds: t.seconds, scenes };
  }

  if (errors.length) return { ok: false, errors: dedupe(errors) };
  const model: Model = { ...opt("title", raw.title), direction: raw.direction, states, kinds, components, connections, groups, views, scenarios, ...opt("tour", tour) };
  return { ok: true, model, warnings };
}
