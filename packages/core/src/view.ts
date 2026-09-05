import { ModelError } from "./declare.js";
import type { Component, Connection, Model, View } from "./types.js";

/**
 * Reduce the model to what one view shows (docs/MODEL.md §5.4). Selection: everything, or the scope group and its
 * descendants, intersected with `only` (a group there means its descendants too). Groups shown are the selected
 * ones plus those containing a selected entity, up to the scope. Connections with one end outside are kept and the
 * outside end becomes a ghost component at the top level (R4): nothing is dropped silently. Closed groups (the view's
 * `collapse` minus `open`) hide their contents and take over their connections (R11).
 */
export function scopeModel(model: Model, view: View, open: readonly string[] = []): Model {
  const base: Model = { ...model, direction: view.direction, ...(view.title !== undefined ? { title: view.title } : {}), views: [view] };
  if (view.scope === undefined && view.only === undefined && view.collapse === undefined) return base;

  const parentOf = new Map(model.groups.map((g) => [g.id, g.parent] as const));
  const groupOf = new Map(model.components.map((c) => [c.id, c.group] as const));
  const isGroup = (id: string) => parentOf.has(id);
  const chain = (id: string): string[] => { const out: string[] = []; for (let cur = isGroup(id) ? parentOf.get(id) : groupOf.get(id); cur !== undefined; cur = parentOf.get(cur)) out.push(cur); return out; };
  const within = (id: string, root: string) => id === root || chain(id).includes(root);
  const all = [...model.components.map((c) => c.id), ...model.groups.map((g) => g.id)];

  let selected = new Set(all);
  if (view.scope !== undefined) selected = new Set(all.filter((id) => within(id, view.scope!)));
  if (view.only !== undefined) {
    const only = new Set(all.filter((id) => view.only!.some((o) => within(id, o))));
    selected = new Set([...selected].filter((id) => only.has(id)));
  }
  // Containing groups of selected entities, up to (and including) the scope.
  const shownGroups = new Set([...selected].filter(isGroup));
  for (const id of selected) for (const g of chain(id)) { if (view.scope !== undefined && !within(g, view.scope)) break; shownGroups.add(g); }
  const shown = new Set([...selected].filter((id) => !isGroup(id)).concat([...shownGroups]));

  // Closed groups (R11): a group in `collapse` that is not in `open` is drawn as one node-sized box. Everything inside
  // it leaves the model, and connections to what was inside re-attach to the box. Closed groups nest: the visible
  // representative of an entity is its outermost closed ancestor. `open` lists the groups a focus has opened.
  const opened = new Set(open);
  const collapsed = new Set((view.collapse ?? []).filter((id) => shownGroups.has(id) && id !== view.scope && !opened.has(id)));
  const representative = (id: string): string => { let rep = id; for (const g of chain(id)) if (collapsed.has(g)) rep = g; return rep; };
  const visible = (id: string) => representative(id) === id;
  const hiddenCount = new Map<string, number>();
  for (const c of model.components) { const box = representative(c.id); if (box !== c.id) hiddenCount.set(box, (hiddenCount.get(box) ?? 0) + 1); }
  const groups = model.groups.filter((g) => shownGroups.has(g.id) && visible(g.id))
    .map((g) => { if (g.id !== view.scope) return g; const { parent, ...root } = g; return root; })
    .map((g) => (collapsed.has(g.id) ? { ...g, collapsed: hiddenCount.get(g.id) ?? 0 } : g));
  const components: Component[] = model.components.filter((c) => shown.has(c.id) && visible(c.id));
  const ghosts = new Map<string, Component>();
  const connections: Connection[] = [];
  for (const c of model.connections) {
    const a = shown.has(c.from), b = shown.has(c.to);
    if (!a && !b) continue;
    for (const end of [c.from, c.to]) if (!shown.has(end) && !ghosts.has(end)) {
      // A ghost is drawn from its flag alone; its kind is carried through for the data attribute but never styled.
      const src = model.components.find((x) => x.id === end) ?? model.groups.find((x) => x.id === end)!;
      ghosts.set(end, { id: end, label: src.label, kind: src.kind, state: src.state, replicas: 1, ghost: true, ...(src.reason !== undefined ? { reason: src.reason } : {}), ...(src.description !== undefined ? { description: src.description } : {}) });
    }
    const from = representative(c.from), to = representative(c.to);
    if (from === to) continue; // internal to a closed group
    // Several connections landing on one pair of boxes are drawn as one line, with their load summed.
    const same = connections.find((x) => x.from === from && x.to === to);
    if (same) { same.load = Math.min(1, Math.round((same.load + c.load) * 100) / 100); continue; }
    connections.push({ ...c, from, to });
  }
  return { ...base, groups, components: [...components, ...ghosts.values()], connections };
}

/** Pick a view by id, or the first one. Throws with the available ids on a miss. */
export function selectView(model: Model, id?: string): View {
  if (id === undefined) return model.views[0]!;
  const v = model.views.find((x) => x.id === id);
  if (!v) throw new ModelError(`unknown view "${id}"; available: ${model.views.map((x) => x.id).join(", ")}`);
  return v;
}
