import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv, type ErrorObject } from "ajv";
import { DEFAULT_COMPONENT_KINDS, DEFAULT_GROUP_KINDS, DEFAULT_NEED_OUTCOMES, DEFAULT_STATE, DEFAULT_STATES, FRAME_PRESETS, GLYPH_PRESETS } from "./defaults.js";
import type { Component, ComponentKindDef, Connection, Direction, Group, GroupKindDef, Kinds, LookPreset, LookStyle, Model, Need, Scenario, ScenarioStep, StateDef, States, View } from "./types.js";

export class ValidationError {
  constructor(public readonly pointer: string, public readonly message: string) {}
  toString(): string { return `${this.pointer}: ${this.message}`; }
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
  views?: { id: string; title?: string; type: "topology"; direction?: Direction; scope?: string; only?: string[] }[];
  scenarios: { id: string; label?: string; steps: { note?: string; set?: Record<string, string | string[]>; restore?: string | string[]; load?: { from?: string; to?: string; id?: string; load: number }[] }[] }[];
}

/* ---------- vocabulary ---------- */
function buildStates(raw: Raw["states"], original: Raw["states"], err: (p: string, m: string) => void): States {
  const define: Record<string, StateDef> = {};
  if (!raw?.replace) for (const [name, d] of Object.entries(DEFAULT_STATES)) define[name] = { name, ...d };
  for (const [name, user] of Object.entries(original?.define ?? {})) {
    const base = define[name] ?? { name, look: "normal" as const, rank: 1, available: true, flows: "keep" as const, cascade: "none" as const };
    define[name] = { ...base, ...(user as Partial<StateDef>), name };
  }
  const def = raw?.default ?? DEFAULT_STATE;
  const unmet = raw?.needs?.unmet ?? DEFAULT_NEED_OUTCOMES.unmet;
  const reduced = raw?.needs?.reduced ?? DEFAULT_NEED_OUTCOMES.reduced;
  const hint = raw?.replace ? ' (states.replace is true, so it must be defined in states.define)' : "";
  if (!define[def]) err("/states/default", `unknown state "${def}"${hint}`);
  if (!define[unmet]) err("/states/needs/unmet", `unknown state "${unmet}"${hint}`);
  if (!define[reduced]) err("/states/needs/reduced", `unknown state "${reduced}"${hint}`);
  return { default: def, needs: { unmet, reduced }, define };
}

function buildKinds(raw: Raw["kinds"], err: (p: string, m: string) => void): Kinds {
  const components: Record<string, ComponentKindDef> = raw?.replace ? {} : { ...DEFAULT_COMPONENT_KINDS };
  const groups: Record<string, GroupKindDef> = raw?.replace ? {} : { ...DEFAULT_GROUP_KINDS };
  for (const [name, k] of Object.entries(raw?.components ?? {})) {
    components[name] = { ...(components[name] ?? {}), ...k };
    if (k.glyph !== undefined && !(GLYPH_PRESETS as readonly string[]).includes(k.glyph) && !/^[Mm][\d\s.,a-zA-Z-]+$/.test(k.glyph))
      err(`/kinds/components/${name}/glyph`, `must be a preset glyph (${GLYPH_PRESETS.join(", ")}) or SVG path data starting with M`);
  }
  for (const [name, k] of Object.entries(raw?.groups ?? {})) {
    groups[name] = { ...(groups[name] ?? { frame: "tier" }), ...k };
    if (typeof k.frame === "string" && !(FRAME_PRESETS as readonly string[]).includes(k.frame)) err(`/kinds/groups/${name}/frame`, `must be one of: ${FRAME_PRESETS.join(", ")}`);
  }
  return { components, groups };
}

/* ---------- main ---------- */
export function validate(input: unknown): ValidationResult {
  const data: unknown = structuredClone(input);
  if (!checkSchema(data)) {
    // A failed oneOf reports every branch's complaints too; keep only the oneOf summary for that subtree.
    const all = checkSchema.errors ?? [];
    const oneOfPaths = all.filter((e) => e.keyword === "oneOf").map((e) => e.instancePath);
    const kept = all.filter((e) => e.keyword === "oneOf" || !oneOfPaths.some((p) => e.instancePath === p || e.instancePath.startsWith(p + "/")));
    return { ok: false, errors: dedupe(kept.map(describe)) };
  }
  const raw = data as Raw;
  const original = (input as Raw) ?? {};
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const err = (p: string, m: string) => errors.push(new ValidationError(p, m));

  const states = buildStates(raw.states, original.states, err);
  const kinds = buildKinds(raw.kinds, err);
  const stateOk = (name: string) => name in states.define;

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
    if (!(g.kind in kinds.groups)) err(`/groups/${i}/kind`, `unknown group kind "${g.kind}"; known: ${Object.keys(kinds.groups).join(", ")}`);
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
    if (!(c.kind in kinds.components)) err(`/components/${i}/kind`, `unknown component kind "${c.kind}"; known: ${Object.keys(kinds.components).join(", ")}`);
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
  const connectedOrViaGroup = (component: string, alt: string) => connected(component, alt) || ancestors(alt).some((g) => connected(component, g));
  // W1: a source connected both to a group and to something inside it
  connections.forEach((c, i) => {
    for (const anc of ancestors(c.to)) if (connections.some((o) => o.from === c.from && o.to === anc)) warnings.push(new ValidationWarning(`/connections/${i}`, `"${c.from}" connects to "${c.to}" and also to its group "${anc}"; both lines will be drawn`));
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
    v.only?.forEach((id, k) => { if (!isEntity(id)) err(`/views/${i}/only/${k}`, `unknown entity "${id}"`); });
    return { id: v.id, type: v.type ?? "topology", direction: v.direction ?? raw.direction, ...opt("title", v.title), ...opt("scope", v.scope), ...opt("only", v.only) };
  });

  /* scenarios */
  const scenarioIds = new Set<string>();
  const scenarios: Scenario[] = raw.scenarios.map((sc, i) => {
    if (scenarioIds.has(sc.id)) err(`/scenarios/${i}/id`, `duplicate scenario id "${sc.id}"`);
    scenarioIds.add(sc.id);
    const steps: ScenarioStep[] = sc.steps.map((st, j) => {
      const base = `/scenarios/${i}/steps/${j}`;
      const seen = new Map<string, string>();
      const set: Record<string, string[]> = {};
      for (const [state, ids] of Object.entries(st.set ?? {})) {
        if (!stateOk(state)) err(`${base}/set/${state}`, `unknown state "${state}"; known: ${Object.keys(states.define).join(", ")}`);
        set[state] = list(ids);
        for (const id of set[state]!) {
          if (!isEntity(id)) err(`${base}/set/${state}`, `unknown entity "${id}"`);
          if (seen.has(id)) err(`${base}/set/${state}`, `"${id}" is already set to "${seen.get(id)}" in this step`);
          seen.set(id, state);
        }
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
        if (l.id !== undefined) { if (!connectionKeys.has(l.id)) err(p, `unknown connection id "${l.id}"`); else key = l.id; }
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

  if (errors.length) return { ok: false, errors: dedupe(errors) };
  const model: Model = { ...opt("title", raw.title), direction: raw.direction, states, kinds, components, connections, groups, views, scenarios };
  return { ok: true, model, warnings };
}
