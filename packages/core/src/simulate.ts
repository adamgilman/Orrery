import type { Component, Connection, Entity, Group, Model, Need } from "./types.js";

/**
 * Propagation: from declared states to effective states, reasons, need markers and effective loads.
 * Pure. Reads only mechanics (rank, available, flows, cascade) and need outcomes; never a state's name.
 * See docs/MODEL.md §5.
 */
export function propagate(input: Model): Model {
  const defs = input.states.define;
  const rank = (s: string) => defs[s]?.rank ?? 0;
  const available = (s: string) => defs[s]?.available ?? true;
  const stops = (s: string) => defs[s]?.flows === "stop";
  const cascades = (s: string) => defs[s]?.cascade === "children";
  const baseRank = rank(input.states.default);

  const entities = new Map<string, Entity>();
  for (const c of input.components) entities.set(c.id, { ...c });
  for (const g of input.groups) entities.set(g.id, { ...g });
  const label = (id: string) => entities.get(id)?.label ?? id;
  const members = new Map<string, string[]>();
  for (const c of input.components) if (c.group) members.set(c.group, [...(members.get(c.group) ?? []), c.id]);
  for (const g of input.groups) if (g.parent) members.set(g.parent, [...(members.get(g.parent) ?? []), g.id]);

  // 1. cascade: a group whose declared state cascades sets every descendant's declared state (higher rank wins).
  const descendants = (id: string): string[] => (members.get(id) ?? []).flatMap((m) => [m, ...descendants(m)]);
  for (const g of input.groups) {
    if (!cascades(g.state)) continue;
    for (const d of descendants(g.id)) {
      const e = entities.get(d)!;
      if (rank(g.state) >= rank(e.state) && e.state !== g.state) entities.set(d, { ...e, state: g.state, reason: `${label(g.id)} is ${g.state}` });
    }
  }

  // 2. needs to a fixed point. Groups get an implicit need over their direct members.
  const state = (id: string) => entities.get(id)!.state;
  const needsOf = (e: Entity): Need[] => {
    if ("needs" in e) return e.needs;
    const m = members.get(e.id) ?? [];
    return m.length ? [{ any: m, min: 1, unmet: input.states.needs.unmet, reduced: input.states.needs.reduced }] : [];
  };
  const evaluate = (need: Need): { state: string; reason: string } | null => {
    const avail = need.any.filter((a) => available(state(a)));
    const missing = need.any.filter((a) => !available(state(a)));
    if (avail.length < need.min) return { state: need.unmet, reason: `needs ${need.any.map(label).join(" or ")} (${avail.length} of ${need.min} available)` };
    if (missing.length) return { state: need.reduced, reason: `${missing.map(label).join(", ")} unavailable, using ${label(avail[0]!)}` };
    if (rank(state(avail[0]!)) > baseRank) return { state: need.reduced, reason: `${label(avail[0]!)} is ${state(avail[0]!)}` };
    return null;
  };
  for (let changed = true, guard = 0; changed && guard <= entities.size; guard++) {
    changed = false;
    for (const e of entities.values()) {
      let best = { state: e.state, reason: e.reason };
      for (const need of needsOf(e)) {
        const r = evaluate(need);
        if (r && rank(r.state) > rank(best.state)) best = r;
      }
      if (best.state !== e.state) { entities.set(e.id, { ...e, state: best.state, ...(best.reason !== undefined ? { reason: best.reason } : {}) }); changed = true; }
    }
  }

  // 3. loads and need markers.
  const byPair = (from: string, to: string) => input.connections.find((c) => c.from === from && c.to === to);
  const loads = new Map(input.connections.map((c) => [c.key, c.load]));
  const needMarks = new Set<string>();
  for (const c of input.components) for (const need of c.needs) {
    const conns = need.any.map((alt) => byPair(c.id, alt) ?? byPair(alt, c.id)).filter((x): x is Connection => !!x);
    for (const conn of conns) needMarks.add(conn.key);
    const firstAvail = need.any.find((a) => available(state(a)));
    const target = firstAvail !== undefined ? byPair(c.id, firstAvail) : undefined;
    if (!target) continue;
    let shifted = 0;
    for (const alt of need.any) {
      if (available(state(alt))) continue;
      const conn = byPair(c.id, alt);
      if (conn) shifted += conn.load;
    }
    if (shifted > 0) loads.set(target.key, Math.min(1, (loads.get(target.key) ?? 0) + shifted));
  }
  const connections = input.connections.map((c) => ({
    ...c,
    load: stops(state(c.from)) || stops(state(c.to)) ? 0 : (loads.get(c.key) ?? c.load),
    ...(needMarks.has(c.key) ? { need: true as const } : {}),
  }));

  return {
    ...input,
    components: input.components.map((c) => entities.get(c.id) as Component),
    groups: input.groups.map((g) => entities.get(g.id) as Group),
    connections,
  };
}

/** Declared-state overrides: state name → entity ids. Unknown names or ids throw. */
export function applySet(model: Model, set: Record<string, string[]>, loads: Record<string, number> = {}): Model {
  const states = new Map<string, string>();
  for (const [s, ids] of Object.entries(set)) {
    if (!(s in model.states.define)) throw new Error(`unknown state "${s}"; known: ${Object.keys(model.states.define).join(", ")}`);
    for (const id of ids) {
      if (!model.components.some((c) => c.id === id) && !model.groups.some((g) => g.id === id)) throw new Error(`unknown entity "${id}"`);
      states.set(id, s);
    }
  }
  return {
    ...model,
    components: model.components.map((c) => (states.has(c.id) ? { ...c, state: states.get(c.id)! } : c)),
    groups: model.groups.map((g) => (states.has(g.id) ? { ...g, state: states.get(g.id)! } : g)),
    connections: model.connections.map((c) => (c.key in loads ? { ...c, load: loads[c.key]! } : c)),
  };
}

export interface ScenarioState { model: Model; scenarioId: string; step: number; steps: number; note?: string }

/** Apply a scenario's steps 1..step (cumulative; default: all) and propagate. Pure. */
export function applyScenario(input: Model, scenarioId: string, step?: number): ScenarioState {
  const sc = input.scenarios.find((s) => s.id === scenarioId);
  if (!sc) throw new Error(`unknown scenario "${scenarioId}"; available: ${input.scenarios.map((s) => s.id).join(", ") || "none"}`);
  const upto = step ?? sc.steps.length;
  if (!Number.isInteger(upto) || upto < 1 || upto > sc.steps.length) throw new Error(`scenario "${scenarioId}": step must be between 1 and ${sc.steps.length}`);
  const declared = new Map<string, string>();
  const base = new Map<string, string>([...input.components.map((c) => [c.id, c.state] as const), ...input.groups.map((g) => [g.id, g.state] as const)]);
  const loads = new Map<string, number>();
  for (const st of sc.steps.slice(0, upto)) {
    for (const [s, ids] of Object.entries(st.set)) for (const id of ids) declared.set(id, s);
    for (const id of st.restore) declared.set(id, base.get(id)!);
    for (const [k, v] of Object.entries(st.load)) loads.set(k, v);
  }
  const set: Record<string, string[]> = {};
  for (const [id, s] of declared) set[s] = [...(set[s] ?? []), id];
  const note = sc.steps[upto - 1]!.note;
  return { model: propagate(applySet(input, set, Object.fromEntries(loads))), scenarioId, step: upto, steps: sc.steps.length, ...(note !== undefined ? { note } : {}) };
}
