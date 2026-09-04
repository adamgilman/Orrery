import type { Diagram, DiagramView } from "./types.js";

/**
 * Reduce the model to what one view shows. Without `scope` that is everything, drawn in the view's direction.
 * With `scope`, it is that group (as the root frame), its descendant groups, their nodes, and edges among them.
 * Edges to nodes outside the scope are dropped for now (stubs are a later refinement).
 */
export function scopeDiagram(diagram: Diagram, view: DiagramView): Diagram {
  const base: Diagram = {
    ...diagram,
    direction: view.direction,
    ...(view.title !== undefined ? { title: view.title } : {}),
    views: [view],
  };
  if (view.scope === undefined) return base;
  const parentOf = new Map(diagram.groups.map((g) => [g.id, g.parent] as const));
  const within = (groupId: string | undefined): boolean => {
    for (let cur = groupId; cur !== undefined; cur = parentOf.get(cur)) if (cur === view.scope) return true;
    return false;
  };
  const groups = diagram.groups
    .filter((g) => within(g.id))
    .map((g) => (g.id === view.scope ? { id: g.id, label: g.label, kind: g.kind } : g));
  const nodes = diagram.nodes.filter((n) => within(n.group));
  const kept = new Set(nodes.map((n) => n.id));
  const edges = diagram.edges.filter((e) => kept.has(e.from) && kept.has(e.to));
  return { ...base, groups, nodes, edges };
}

/** Pick a view by id, or the first one. Throws with the available ids on a miss. */
export function selectView(diagram: Diagram, id?: string): DiagramView {
  if (id === undefined) return diagram.views[0]!;
  const v = diagram.views.find((x) => x.id === id);
  if (!v) throw new Error(`unknown view "${id}"; available: ${diagram.views.map((x) => x.id).join(", ")}`);
  return v;
}
