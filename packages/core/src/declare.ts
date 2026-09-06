import type { Callout, Model } from "./types.js";

/** A request the model cannot satisfy: unknown view, scenario, state, entity, or step. Callers report it, not a stack. */
export class ModelError extends Error {}

/**
 * Put entities in states, with the author's reasons, and set connection loads. Unknown names or ids throw.
 * A reason is kept only with the state it was given for: setting an entity again without one clears it.
 */
export function applySet(model: Model, set: Record<string, string[]>, loads: Record<string, number> = {}, reasons: Record<string, string> = {}): Model {
  const states = new Map<string, string>();
  for (const [s, ids] of Object.entries(set)) {
    if (!Object.hasOwn(model.states.define, s)) throw new ModelError(`unknown state "${s}"; known: ${Object.keys(model.states.define).join(", ")}`);
    for (const id of ids) {
      if (!model.components.some((c) => c.id === id) && !model.groups.some((g) => g.id === id)) throw new ModelError(`unknown entity "${id}"`);
      states.set(id, s);
    }
  }
  const place = <E extends { id: string; state: string; reason?: string }>(e: E): E => {
    if (!states.has(e.id)) return e;
    const { reason, ...rest } = e;
    const why = reasons[e.id];
    return { ...rest, state: states.get(e.id)!, ...(why !== undefined ? { reason: why } : {}) } as E;
  };
  return {
    ...model,
    components: model.components.map(place),
    groups: model.groups.map(place),
    connections: model.connections.map((c) => (Object.hasOwn(loads, c.key) ? { ...c, load: loads[c.key]! } : c)),
  };
}

export interface Declaration {
  /** Scenario to fold in, steps 1..step (default: all). */
  scenario?: string;
  step?: number;
  /** A what-if applied after the scenario: state name → entity ids. */
  set?: Record<string, string[]>;
  reasons?: Record<string, string>;
  loads?: Record<string, number>;
  /** Callouts for this moment, after the step's (R16). */
  callouts?: Callout[];
}

/**
 * The model in a situation: the base model, then scenario steps 1..step (set, restore, load) in order, then the
 * what-if. Nothing is computed: every state, reason and load is one the author wrote (MODEL.md §5). The single
 * place scenario semantics are folded; render, CLI and runtime all call this, then `stopFlows`.
 */
export function declare(model: Model, d: Declaration = {}): { model: Model; step?: number; steps?: number; note?: string } {
  const states = new Map<string, string>();
  const reasons = new Map<string, string>();
  const loads = new Map<string, number>(Object.entries(d.loads ?? {}));
  let step: number | undefined, steps: number | undefined, note: string | undefined;
  const callouts: Callout[] = [...model.callouts];
  if (d.scenario !== undefined) {
    const sc = model.scenarios.find((s) => s.id === d.scenario);
    if (!sc) throw new ModelError(`unknown scenario "${d.scenario}"; available: ${model.scenarios.map((s) => s.id).join(", ") || "none"}`);
    step = d.step ?? sc.steps.length;
    steps = sc.steps.length;
    if (!Number.isInteger(step) || step < 1 || step > steps) throw new ModelError(`scenario "${d.scenario}": step must be between 1 and ${steps}`);
    const base = new Map<string, string>([...model.components.map((c) => [c.id, c.state] as const), ...model.groups.map((g) => [g.id, g.state] as const)]);
    for (const st of sc.steps.slice(0, step)) {
      for (const [s, ids] of Object.entries(st.set)) for (const id of ids) { states.set(id, s); reasons.delete(id); }
      for (const [id, why] of Object.entries(st.reasons)) reasons.set(id, why);
      for (const id of st.restore) { states.set(id, base.get(id)!); reasons.delete(id); }
      for (const [k, v] of Object.entries(st.load)) loads.set(k, v);
    }
    note = sc.steps[step - 1]!.note;
    callouts.push(...sc.steps[step - 1]!.callouts);
  }
  for (const [s, ids] of Object.entries(d.set ?? {})) for (const id of ids) { states.set(id, s); reasons.delete(id); }
  for (const [id, why] of Object.entries(d.reasons ?? {})) reasons.set(id, why);
  const set: Record<string, string[]> = Object.create(null);
  for (const [id, s] of states) set[s] = [...(set[s] ?? []), id];
  callouts.push(...(d.callouts ?? []));
  return { model: { ...applySet(model, set, Object.fromEntries(loads), Object.fromEntries(reasons)), callouts }, ...(step !== undefined && steps !== undefined ? { step, steps } : {}), ...(note !== undefined ? { note } : {}) };
}

/**
 * The one drawing rule over declared loads (MODEL.md §5.2): a connection touching an entity whose state has
 * `flows: stop` is drawn with no flow. Every other load is exactly as declared. Pure.
 */
export function stopFlows(model: Model): Model {
  const stops = new Set<string>();
  for (const e of [...model.components, ...model.groups]) if (model.states.define[e.state]?.flows === "stop") stops.add(e.id);
  if (stops.size === 0) return model;
  return { ...model, connections: model.connections.map((c) => (stops.has(c.from) || stops.has(c.to) ? { ...c, load: 0 } : c)) };
}
