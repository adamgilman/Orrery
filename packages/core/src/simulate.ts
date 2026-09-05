import type { Component, Connection, Entity, Group, Model, Need } from "./types.js";

/** A request the model cannot satisfy: unknown view, scenario, state, entity, or step. Callers report it, not a stack. */
export class ModelError extends Error {}

/**
 * Propagation: from declared states to effective states, reasons, need markers and effective loads.
 * Pure. Reads only mechanics (rank, available, flows, cascade) and need outcomes; never a state's name.
 * See docs/MODEL.md §5. Alternatives absent from the model (a scoped view) are ignored; propagate before scoping.
 */
export function propagate(input: Model): Model {
  const defs = input.states.define;
  const def = (s: string) => (Object.hasOwn(defs, s) ? defs[s]! : undefined);
  const rank = (s: string) => def(s)?.rank ?? 0;
  const available = (s: string) => def(s)?.available ?? true;
  const stops = (s: string) => def(s)?.flows === "stop";
  const cascades = (s: string) => def(s)?.cascade === "children";
  const baseRank = rank(input.states.default);

  const components = new Map(input.components.map((c) => [c.id, { ...c }]));
  const groups = new Map(input.groups.map((g) => [g.id, { ...g }]));
  const entity = (id: string): Entity | undefined => components.get(id) ?? groups.get(id);
  const label = (id: string) => entity(id)?.label ?? id;
  const state = (id: string) => entity(id)!.state;
  const setEntity = (e: Entity) => (components.has(e.id) ? components.set(e.id, e as Component) : groups.set(e.id, e as Group));
  const members = new Map<string, string[]>();
  for (const c of input.components) if (c.group) members.set(c.group, [...(members.get(c.group) ?? []), c.id]);
  for (const g of input.groups) if (g.parent) members.set(g.parent, [...(members.get(g.parent) ?? []), g.id]);
  const ancestors = (id: string): Group[] => {
    const out: Group[] = [];
    for (let cur = components.get(id)?.group ?? groups.get(id)?.parent; cur !== undefined; cur = groups.get(cur)?.parent) { const g = groups.get(cur); if (!g) break; out.push(g); }
    return out;
  };

  // 1. Cascade: each entity takes the highest-ranked cascading declared state among its ancestors, nearest first
  //    on ties, and only when that rank is strictly above its own declared state (ties keep the declared state).
  const declaredGroups = new Map(input.groups.map((g) => [g.id, g.state]));
  for (const e of [...components.values(), ...groups.values()]) {
    let best: { id: string; state: string } | undefined;
    for (const a of ancestors(e.id)) {
      const st = declaredGroups.get(a.id)!;
      if (cascades(st) && (!best || rank(st) > rank(best.state))) best = { id: a.id, state: st };
    }
    if (best && rank(best.state) > rank(e.state)) setEntity({ ...e, state: best.state, reason: `${label(best.id)} is ${best.state}` });
  }

  // 2. Needs, to a fixed point. Groups get an implicit, unordered need over their direct members. Entities whose
  //    state is already unavailable are not evaluated: they are down, and a need cannot make them more so.
  type Eval = Need & { unordered?: true };
  const needsOf = (e: Entity): Eval[] => {
    if ("needs" in e) return e.needs.map((n) => ({ ...n, any: n.any.filter((a) => entity(a) !== undefined) })).filter((n) => n.any.length > 0);
    const m = members.get(e.id) ?? [];
    return m.length ? [{ any: m, min: 1, unmet: input.states.needs.unmet, reduced: input.states.needs.reduced, unordered: true }] : [];
  };
  const evaluate = (need: Eval): { state: string; reason: string } | null => {
    const avail = need.any.filter((a) => available(state(a)));
    const missing = need.any.filter((a) => !available(state(a)));
    if (avail.length < need.min) return { state: need.unmet, reason: `needs ${need.any.map(label).join(" or ")} (${avail.length} of ${need.min} available)` };
    if (missing.length) return { state: need.reduced, reason: need.unordered ? `${missing.map(label).join(", ")} unavailable` : `${missing.map(label).join(", ")} unavailable, using ${label(avail[0]!)}` };
    const above = (need.unordered ? avail : avail.slice(0, 1)).filter((a) => rank(state(a)) > baseRank);
    if (above.length) return { state: need.reduced, reason: above.map((a) => `${label(a)} is ${state(a)}`).join("; ") };
    return null;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const e of [...components.values(), ...groups.values()]) {
      if (!available(e.state)) continue;
      let best: { state: string; reason?: string } = { state: e.state, ...(e.reason !== undefined ? { reason: e.reason } : {}) };
      for (const need of needsOf(e)) {
        const r = evaluate(need);
        if (r && rank(r.state) > rank(best.state)) best = r;
      }
      if (best.state !== e.state) { setEntity({ ...e, state: best.state, ...(best.reason !== undefined ? { reason: best.reason } : {}) }); changed = true; }
    }
  }

  // 3. Loads and need markers. A need is satisfied along every connection between the component and an
  //    alternative, or between the component and a group containing the alternative. Load shifts only along
  //    connections the component initiates directly to alternatives: off the unavailable ones, onto the first
  //    connection to the first available alternative, capped at 1.
  const loads = new Map(input.connections.map((c) => [c.key, c.load]));
  const needMarks = new Set<string>();
  const between = (a: string, b: string) => input.connections.filter((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a));
  const from = (a: string, b: string) => input.connections.filter((c) => c.from === a && c.to === b);
  for (const c of input.components) for (const need of c.needs) {
    for (const alt of need.any) {
      for (const conn of between(c.id, alt)) needMarks.add(conn.key);
      for (const g of ancestors(alt)) for (const conn of between(c.id, g.id)) needMarks.add(conn.key);
    }
    const firstAvail = need.any.find((a) => entity(a) !== undefined && available(state(a)));
    const target = firstAvail !== undefined ? from(c.id, firstAvail)[0] : undefined;
    let shifted = 0;
    for (const alt of need.any) {
      if (entity(alt) === undefined || available(state(alt))) continue;
      for (const conn of from(c.id, alt)) { shifted += loads.get(conn.key) ?? 0; loads.set(conn.key, 0); }
    }
    if (target && shifted > 0) loads.set(target.key, Math.min(1, (loads.get(target.key) ?? 0) + shifted));
  }
  const connections = input.connections.map((c) => ({
    ...c,
    load: stops(state(c.from)) || stops(state(c.to)) ? 0 : (loads.get(c.key) ?? c.load),
    ...(needMarks.has(c.key) ? { need: true as const } : {}),
  }));

  return { ...input, components: input.components.map((c) => components.get(c.id)!), groups: input.groups.map((g) => groups.get(g.id)!), connections };
}

/** Declared-state overrides: state name → entity ids, plus connection loads by key. Unknown names or ids throw. */
export function applySet(model: Model, set: Record<string, string[]>, loads: Record<string, number> = {}): Model {
  const states = new Map<string, string>();
  for (const [s, ids] of Object.entries(set)) {
    if (!Object.hasOwn(model.states.define, s)) throw new ModelError(`unknown state "${s}"; known: ${Object.keys(model.states.define).join(", ")}`);
    for (const id of ids) {
      if (!model.components.some((c) => c.id === id) && !model.groups.some((g) => g.id === id)) throw new ModelError(`unknown entity "${id}"`);
      states.set(id, s);
    }
  }
  return {
    ...model,
    components: model.components.map((c) => (states.has(c.id) ? { ...c, state: states.get(c.id)! } : c)),
    groups: model.groups.map((g) => (states.has(g.id) ? { ...g, state: states.get(g.id)! } : g)),
    connections: model.connections.map((c) => (Object.hasOwn(loads, c.key) ? { ...c, load: loads[c.key]! } : c)),
  };
}

export interface Declaration {
  /** Scenario to fold in, steps 1..step (default: all). */
  scenario?: string;
  step?: number;
  /** Overrides applied after the scenario: state name → entity ids. */
  set?: Record<string, string[]>;
  loads?: Record<string, number>;
}

/**
 * The declared model for a situation: base model, then scenario steps 1..step (set, restore, load), then
 * overrides. Not propagated. The single place scenario semantics (§5.4) are folded; render, CLI and runtime all
 * call this and then `propagate`.
 */
export function declare(model: Model, d: Declaration = {}): { model: Model; step?: number; steps?: number; note?: string } {
  const states = new Map<string, string>();
  const loads = new Map<string, number>(Object.entries(d.loads ?? {}));
  let step: number | undefined, steps: number | undefined, note: string | undefined;
  if (d.scenario !== undefined) {
    const sc = model.scenarios.find((s) => s.id === d.scenario);
    if (!sc) throw new ModelError(`unknown scenario "${d.scenario}"; available: ${model.scenarios.map((s) => s.id).join(", ") || "none"}`);
    step = d.step ?? sc.steps.length;
    steps = sc.steps.length;
    if (!Number.isInteger(step) || step < 1 || step > steps) throw new ModelError(`scenario "${d.scenario}": step must be between 1 and ${steps}`);
    const base = new Map<string, string>([...model.components.map((c) => [c.id, c.state] as const), ...model.groups.map((g) => [g.id, g.state] as const)]);
    for (const st of sc.steps.slice(0, step)) {
      for (const [s, ids] of Object.entries(st.set)) for (const id of ids) states.set(id, s);
      for (const id of st.restore) states.set(id, base.get(id)!);
      for (const [k, v] of Object.entries(st.load)) loads.set(k, v);
    }
    note = sc.steps[step - 1]!.note;
  }
  for (const [s, ids] of Object.entries(d.set ?? {})) for (const id of ids) states.set(id, s);
  const set: Record<string, string[]> = Object.create(null);
  for (const [id, s] of states) set[s] = [...(set[s] ?? []), id];
  return { model: applySet(model, set, Object.fromEntries(loads)), ...(step !== undefined && steps !== undefined ? { step, steps } : {}), ...(note !== undefined ? { note } : {}) };
}

export interface ScenarioState { model: Model; scenarioId: string; step: number; steps: number; note?: string }

/** Apply a scenario's steps 1..step (cumulative; default: all) and propagate. Pure. */
export function applyScenario(input: Model, scenarioId: string, step?: number): ScenarioState {
  const d = declare(input, { scenario: scenarioId, ...(step !== undefined ? { step } : {}) });
  return { model: propagate(d.model), scenarioId, step: d.step!, steps: d.steps!, ...(d.note !== undefined ? { note: d.note } : {}) };
}
