import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv, type ErrorObject } from "ajv";
import { DEFAULT_COMPONENT_KINDS, DEFAULT_GROUP_KINDS, DEFAULT_NEED_OUTCOMES, DEFAULT_STATE, DEFAULT_STATES, FRAME_PRESETS, GLYPH_PRESETS, NEW_STATE_DEFAULTS } from "./defaults.js";
import { CSS_COLOR } from "./looks.js";
import type { Component, ComponentKindDef, Connection, Direction, Group, GroupKindDef, Kinds, LookPreset, LookStyle, Model, Need, Scenario, ScenarioStep, Scene, StateDef, States, Tour, View } from "./types.js";

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

/* ---------- raw shapes (after schema defaults) ---------- */
interface RawStateDef { look?: LookPreset | LookStyle; rank?: number; available?: boolean; flows?: "keep" | "stop"; cascade?: "none" | "children"; description?: string }
interface RawNeed { any: string[]; min?: number; unmet?: string; reduced?: string }
interface Raw {
  title?: string; direction: Direction;
  states?: { default?: string; needs?: { unmet?: string; reduced?: string }; replace?: boolean; define?: Record<string, RawStateDef> };
  kinds?: { replace?: boolean; components?: Record<string, ComponentKindDef>; groups?: Record<string, GroupKindDef> };
  components: { id: string; label?: string; kind: string; group?: string; state?: string; needs: (string | RawNeed)[]; replicas: number; tech?: string; description?: string; meta?: Record<string, unknown> }[];
  connections: { from: string; to: string; id?: string; kind: Connection["kind"]; label?: string; load: number; bidirectional: boolean; meta?: Record<string, unknown> }[];
  groups: { id: string; label?: string; kind: string; parent?: string; state?: string; description?: string; meta?: Record<string, unknown> }[];
  views?: { id: string; title?: string; type: "topology"; direction?: Direction; scope?: string; only?: string[]; play?: { scenario: string; seconds: number }; collapse?: string[] }[];
  scenarios: { id: string; label?: string; steps: { note?: string; set?: Record<string, string | string[]>; restore?: string | string[]; load?: { from?: string; to?: string; id?: string; load: number }[] }[] }[];
  tour?: { seconds: number; views?: string[]; scenes?: { view: string; focus?: string; scenario?: string; step?: number; set?: Record<string, string | string[]>; note?: string; seconds?: number }[] };
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
  const unmet = raw?.needs?.unmet ?? DEFAULT_NEED_OUTCOMES.unmet;
  const reduced = raw?.needs?.reduced ?? DEFAULT_NEED_OUTCOMES.reduced;
  const missing = (field: string, name: string, given: boolean) =>
    err(field, raw?.replace && !given ? `states.replace is true, so ${field.slice(1).replace(/\//g, ".")} must name one of: ${Object.keys(define).join(", ")}` : `unknown state "${name}"; known: ${Object.keys(define).join(", ")}`);
  if (!Object.hasOwn(define, def)) missing("/states/default", def, given?.default !== undefined);
  if (!Object.hasOwn(define, unmet)) missing("/states/needs/unmet", unmet, given?.needs?.unmet !== undefined);
  if (!Object.hasOwn(define, reduced)) missing("/states/needs/reduced", reduced, given?.needs?.reduced !== undefined);
  return { default: def, needs: { unmet, reduced }, define };
}

function buildKinds(raw: Raw["kinds"], err: (p: string, m: string) => void): Kinds {
  const components: Record<string, ComponentKindDef> = Object.assign(Object.create(null), raw?.replace ? {} : DEFAULT_COMPONENT_KINDS);
  const groups: Record<string, GroupKindDef> = Object.assign(Object.create(null), raw?.replace ? {} : DEFAULT_GROUP_KINDS);
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
  return { components, groups };
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
  const connected = (a: string, b: string) => connections.some((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a));
  // A need is joined by a connection to the alternative itself, to a group containing it, or to something inside it.
  const inside = (id: string, groupId: string) => ancestors(id).includes(groupId);
  const connectedOrViaGroup = (component: string, alt: string) =>
    connected(component, alt) || ancestors(alt).some((g) => connected(component, g)) || connections.some((c) => (c.from === component && inside(c.to, alt)) || (c.to === component && inside(c.from, alt)));
  // W1: an entity connected both to a group and to something inside it, in either direction.
  connections.forEach((c, i) => {
    for (const anc of ancestors(c.to)) if (connections.some((o) => o.from === c.from && o.to === anc)) warnings.push(new ValidationWarning(`/connections/${i}`, `"${c.from}" connects to "${c.to}" and also to its group "${anc}"; both lines will be drawn`));
    for (const anc of ancestors(c.from)) if (connections.some((o) => o.to === c.to && o.from === anc)) warnings.push(new ValidationWarning(`/connections/${i}`, `"${c.from}" connects to "${c.to}" and so does its group "${anc}"; both lines will be drawn`));
  });

  /* components with needs */
  const components: Component[] = raw.components.map((c, i) => {
    const needs: Need[] = c.needs.map((n, j) => {
      const base = `/components/${i}/needs/${j}`;
      const need: Need = typeof n === "string"
        ? { any: [n], min: 1, unmet: states.needs.unmet, reduced: states.needs.reduced }
        : { any: n.any, min: n.min ?? 1, unmet: n.unmet ?? states.needs.unmet, reduced: n.reduced ?? states.needs.reduced };
      if (typeof n !== "string" && need.min > need.any.length) err(`${base}/min`, `min ${need.min} exceeds the ${need.any.length} alternatives`);
      if (!stateOk(need.unmet)) err(`${base}/unmet`, `unknown state "${need.unmet}"`);
      if (!stateOk(need.reduced)) err(`${base}/reduced`, `unknown state "${need.reduced}"`);
      need.any.forEach((alt, k) => {
        const p = typeof n === "string" ? base : `${base}/any/${k}`;
        if (!isEntity(alt)) return err(p, `unknown entity "${alt}"`);
        if (alt === c.id) return err(p, `"${c.id}" cannot need itself`);
        if (ancestors(c.id).includes(alt)) return err(p, `"${alt}" contains "${c.id}"; a component cannot need its own group`);
        if (!connectedOrViaGroup(c.id, alt)) err(p, `"${c.id}" needs "${alt}" but no connection joins them; add one`);
      });
      return need;
    });
    return { id: c.id, label: c.label ?? c.id, kind: c.kind, state: c.state ?? states.default, needs, replicas: c.replicas, ...opt("group", c.group), ...opt("tech", c.tech), ...opt("description", c.description), ...opt("meta", c.meta) };
  });
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
      for (const [state, ids] of Object.entries(st.set ?? {})) {
        if (!stateOk(state)) err(`${base}/set/${state}`, `unknown state "${state}"; known: ${Object.keys(states.define).join(", ")}`);
        set[state] = list(ids);
        set[state]!.forEach((id, k) => {
          const p = Array.isArray(ids) ? `${base}/set/${state}/${k}` : `${base}/set/${state}`;
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
      return { ...opt("note", st.note), set, restore, load };
    });
    return { id: sc.id, label: sc.label ?? sc.id, steps };
  });

  /* tour: a plain list of views, or scenes */
  let tour: Tour | undefined;
  if (raw.tour) {
    const t = raw.tour;
    if (!t.views && !t.scenes) err("/tour", "give views or scenes");
    t.views?.forEach((id, k) => { if (!viewIds.has(id)) err(`/tour/views/${k}`, `unknown view "${id}"`); });
    type RawScene = { view: string; focus?: string; scenario?: string; step?: number; set?: Record<string, string | string[]>; note?: string; seconds?: number };
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
      for (const [state, ids] of Object.entries(sc.set ?? {})) {
        if (!stateOk(state)) err(`${base}/set/${state}`, `unknown state "${state}"; known: ${Object.keys(states.define).join(", ")}`);
        set[state] = list(ids);
        for (const id of set[state]!) if (!isEntity(id)) err(`${base}/set/${state}`, `unknown entity "${id}"`);
      }
      return { view: sc.view, seconds: sc.seconds ?? t.seconds, ...opt("focus", sc.focus), ...opt("scenario", sc.scenario), ...opt("step", sc.step), ...(sc.set ? { set } : {}), ...opt("note", sc.note) };
    });
    tour = { seconds: t.seconds, scenes };
  }

  if (errors.length) return { ok: false, errors: dedupe(errors) };
  const model: Model = { ...opt("title", raw.title), direction: raw.direction, states, kinds, components, connections, groups, views, scenarios, ...opt("tour", tour) };
  return { ok: true, model, warnings };
}
