import type { Diagram, DiagramEdge, DiagramNode, NodeState } from "./types.js";

const DOWN: ReadonlySet<NodeState> = new Set(["off", "failed"]);
const RANK: Record<NodeState, number> = { on: 0, degraded: 1, failed: 2, off: 2 };

/**
 * Compute effective node states and edge loads from declared states and dependency edges. Pure.
 *
 * Rules:
 * - A node with a `dependsOn` edge to a down (off/failed) target fails, unless it has a `fallback` edge to a
 *   healthy target, in which case it is degraded and the fallback edge takes over the failed edge's load.
 * - A node with a `dependsOn` edge to a degraded target is degraded.
 * - Declared states are a floor: propagation only ever worsens a node, never heals it.
 * - Edges touching a down node carry no load. Other edges keep their declared load.
 * Iterates to a fixed point, so chains and cycles converge; states only move up in severity, so it terminates.
 */
export function propagate(input: Diagram): Diagram {
  const nodes = new Map(input.nodes.map((n) => [n.id, { ...n } as DiagramNode]));
  const label = (id: string) => nodes.get(id)?.label ?? id;
  const isDown = (id: string) => DOWN.has(nodes.get(id)!.state);
  const outEdges = new Map<string, DiagramEdge[]>();
  for (const e of input.edges) outEdges.set(e.from, [...(outEdges.get(e.from) ?? []), e]);

  for (let changed = true, guard = 0; changed && guard < nodes.size + 1; guard++) {
    changed = false;
    for (const n of nodes.values()) {
      if (isDown(n.id)) continue;
      const mine = outEdges.get(n.id) ?? [];
      const covered = (dep: DiagramEdge) => mine.find((f) => f.fallback && f.fallbackFor === dep.id && nodes.get(f.to)!.state === "on");
      let next: NodeState | undefined;
      const reasons: string[] = [];
      for (const dep of mine.filter((e) => e.dependsOn)) {
        const t = nodes.get(dep.to)!;
        if (isDown(dep.to)) {
          const f = covered(dep);
          if (f) { next = next ?? "degraded"; reasons.push(`${label(dep.to)} is down, using ${label(f.to)}`); }
          else if (dep.dependsOn === "soft") { next = next ?? "degraded"; reasons.push(`${label(dep.to)} is down (soft dependency)`); }
          else { next = "failed"; reasons.push(`depends on ${label(dep.to)}`); }
        } else if (t.state === "degraded") {
          next = next ?? "degraded"; reasons.push(`${label(dep.to)} degraded`);
        }
      }
      if (next !== undefined && RANK[next] > RANK[n.state]) {
        nodes.set(n.id, { ...n, state: next, reason: reasons.join("; ") });
        changed = true;
      }
    }
  }

  const edges = input.edges.map((e) => {
    if (isDown(e.from) || isDown(e.to)) return { ...e, load: 0 };
    if (e.fallback && e.fallbackFor !== undefined) {
      const primary = input.edges.find((d) => d.id === e.fallbackFor);
      const takenOver = primary && isDown(primary.to) ? primary.load : 0;
      return { ...e, load: Math.max(e.load, takenOver) };
    }
    return { ...e };
  });
  return { ...input, nodes: input.nodes.map((n) => nodes.get(n.id)!), edges };
}

export interface ScenarioState {
  /** The model with the scenario's overrides applied up to `step`, then propagated. */
  diagram: Diagram;
  scenarioId: string;
  step: number;
  steps: number;
  note?: string;
}

/** Apply a scenario's steps 1..step (cumulative; default: all) to the model and propagate. Pure. */
export function applyScenario(input: Diagram, scenarioId: string, step?: number): ScenarioState {
  const sc = input.scenarios.find((s) => s.id === scenarioId);
  if (!sc) throw new Error(`unknown scenario "${scenarioId}"; available: ${input.scenarios.map((s) => s.id).join(", ") || "none"}`);
  const upto = step ?? sc.steps.length;
  if (!Number.isInteger(upto) || upto < 1 || upto > sc.steps.length) throw new Error(`scenario "${scenarioId}": step must be between 1 and ${sc.steps.length}`);
  const states = new Map<string, NodeState>();
  const loads = new Map<string, number>();
  for (const st of sc.steps.slice(0, upto)) {
    for (const [id, v] of Object.entries(st.nodes)) states.set(id, v.state);
    for (const [id, v] of Object.entries(st.edges)) loads.set(id, v.load);
  }
  const overridden: Diagram = {
    ...input,
    nodes: input.nodes.map((n) => (states.has(n.id) ? { ...n, state: states.get(n.id)! } : n)),
    edges: input.edges.map((e) => (loads.has(e.id) ? { ...e, load: loads.get(e.id)! } : e)),
  };
  const note = sc.steps[upto - 1]!.note;
  return { diagram: propagate(overridden), scenarioId, step: upto, steps: sc.steps.length, ...(note !== undefined ? { note } : {}) };
}
