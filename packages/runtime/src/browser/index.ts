import { applySet, propagate } from "@orrery/core/simulate";
import { flowDuration, flowStyle } from "@orrery/core/flow";
import type { Model } from "@orrery/core/types";
import { fitView, transformOf, zoomToBox, type Box, type Camera, type Size } from "./camera.js";
import { continuedDelay } from "./phase.js";

const PANEL_W = 280, MARGIN = 24, XHTML = "http://www.w3.org/1999/xhtml";
const RUNTIME_CSS = `
.scene .node{cursor:pointer}
.scene .node.is-selected .node-box{stroke:#2563eb;stroke-width:2.5;filter:drop-shadow(0 0 6px rgba(37,99,235,.45))}
.scene .group.is-selected .group-box{stroke:#2563eb;stroke-width:2}
.view.has-hover .node:not(.is-hot),.view.has-hover .edge:not(.is-hot),.view.has-hover .flow:not(.is-hot),.view.has-hover .edge-label:not(.is-hot){opacity:.18;transition:opacity .15s}
.node,.edge,.flow,.edge-label{transition:opacity .15s}`;
const PANEL_CSS = `
.orrery-panel{box-sizing:border-box;width:${PANEL_W}px;height:100%;overflow:auto;padding:14px 14px 20px;background:rgba(248,250,252,.96);border-right:1px solid #e2e8f0;font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a}
.orrery-panel h1{font-size:15px;margin:0 0 10px}
.orrery-panel label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin:12px 0 4px}
.orrery-panel select,.orrery-panel button{font:inherit;padding:4px 8px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:inherit}
.orrery-panel select{width:100%}
.orrery-panel button{cursor:pointer}.orrery-panel button:hover{background:#f1f5f9}
.orrery-steps{display:flex;gap:6px;align-items:center;margin-top:6px}
.orrery-step{color:#64748b;min-width:44px;text-align:center}
.orrery-note{margin:6px 0 0;color:#334155;min-height:1.4em}
.orrery-outline{list-style:none;margin:0;padding:0}
.orrery-outline li{padding:3px 6px;border-radius:5px;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.orrery-outline li:hover{background:#e2e8f0}.orrery-outline li.is-active{background:#dbeafe}
.orrery-outline li[data-type=group]{color:#475569;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
.orrery-dot{width:8px;height:8px;border-radius:50%;background:#16a34a;flex:none;border:1px solid transparent}
.orrery-states{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.orrery-states button{font-size:11px;padding:2px 7px}.orrery-states button.is-on{border-color:#2563eb;color:#2563eb}
.orrery-help{margin-top:14px;color:#64748b;font-size:11px;line-height:1.6}
.orrery-help kbd{border:1px solid #cbd5e1;border-radius:4px;padding:0 4px;background:#fff;font:inherit}
.orrery-reset{margin-top:12px}`;

export interface BootOptions { size?: Size }
export interface Runtime {
  showView(id: string): void;
  setScenario(id: string | null, step?: number): void;
  reset(): void;
}

const bbox = (el: Element): Box => { const [x, y, w, h] = (el.getAttribute("data-bbox") ?? "0 0 0 0").split(" ").map(Number); return { x: x!, y: y!, width: w!, height: h! }; };
const h = <K extends string>(tag: K, cls?: string, text?: string) => {
  const el = document.createElementNS(XHTML, tag) as HTMLElement;
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};

export function boot(root: SVGSVGElement, opts: BootOptions = {}): Runtime {
  const model = JSON.parse(root.querySelector("#orrery-model")!.textContent ?? "{}") as Model;
  const stateNames = Object.keys(model.states.define);
  type Look = { stroke?: string; pulse?: boolean };
  const PRESETS: Record<string, Look> = { normal: {}, warn: { stroke: "#d97706" }, alert: { stroke: "#dc2626", pulse: true }, muted: { stroke: "#94a3b8" }, highlight: { stroke: "#2563eb" } };
  const lookOf = (name: string): Look => { const l = model.states.define[name]?.look; return typeof l === "string" ? PRESETS[l] ?? {} : (l ?? {}); };
  const dotColor = (name: string) => (name === model.states.default ? "#16a34a" : lookOf(name).stroke ?? "#94a3b8");
  const scene = root.querySelector<SVGGElement>(".scene")!;
  const layers = new Map([...root.querySelectorAll<SVGGElement>("g.view")].map((g) => [g.getAttribute("data-view")!, g]));
  const screen = (): Size => opts.size ?? { width: window.innerWidth, height: window.innerHeight };
  const frame = () => ({ left: PANEL_W, margin: MARGIN });

  // ---- state ----
  let activeId = [...layers.keys()][0]!;
  const overrides = new Map<string, string>();
  let scenario: { id: string; step: number } | null = null;
  let selected: { id: string; type: "node" | "group" } | null = null;
  let camera: Camera = { k: 1, tx: 0, ty: 0 };
  let tween: ReturnType<typeof setTimeout> | undefined;

  // ---- document setup ----
  root.removeAttribute("viewBox");
  root.setAttribute("width", "100%");
  root.setAttribute("height", "100%");
  root.style.background = "#fff";
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = RUNTIME_CSS;
  root.insertBefore(style, scene);

  // ---- panel ----
  const fo = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
  fo.setAttribute("x", "0"); fo.setAttribute("y", "0"); fo.setAttribute("width", String(PANEL_W)); fo.setAttribute("height", "100%");
  const panel = h("div", "orrery-panel");
  const pstyle = h("style"); pstyle.textContent = PANEL_CSS; panel.appendChild(pstyle);
  panel.appendChild(h("h1", "orrery-title", model.title ?? "Diagram"));
  panel.appendChild(h("label", undefined, "View"));
  const viewSel = h("select", "orrery-views") as HTMLSelectElement;
  for (const [id, g] of layers) { const o = h("option", undefined, g.getAttribute("data-title") ?? id) as HTMLOptionElement; o.value = id; viewSel.appendChild(o); }
  panel.appendChild(viewSel);
  panel.appendChild(h("label", undefined, "Scenario"));
  const scSel = h("select", "orrery-scenarios") as HTMLSelectElement;
  const none = h("option", undefined, "None") as HTMLOptionElement; none.value = ""; scSel.appendChild(none);
  for (const s of model.scenarios) { const o = h("option", undefined, s.label) as HTMLOptionElement; o.value = s.id; scSel.appendChild(o); }
  panel.appendChild(scSel);
  const steps = h("div", "orrery-steps");
  const prev = h("button", "orrery-prev", "◀"), next = h("button", "orrery-next", "▶"), stepLbl = h("span", "orrery-step", "");
  steps.append(prev, stepLbl, next); panel.appendChild(steps);
  const note = h("p", "orrery-note", ""); panel.appendChild(note);
  panel.appendChild(h("label", undefined, "Selected"));
  const stateBar = h("div", "orrery-states"); panel.appendChild(stateBar);
  for (const name of stateNames) {
    const b = h("button", "orrery-state", name); b.setAttribute("data-state", name);
    b.addEventListener("click", () => { if (selected) setState(selected.id, name); });
    stateBar.appendChild(b);
  }
  panel.appendChild(h("label", undefined, "Outline"));
  const outline = h("ul", "orrery-outline"); panel.appendChild(outline);
  const help = h("div", "orrery-help");
  help.innerHTML = `Click a component to set it to <b>${model.states.needs.unmet}</b> (click again to undo), <kbd>shift</kbd>+click to cycle states, or pick a state above. <kbd>↑</kbd><kbd>↓</kbd> select, <kbd>⏎</kbd> zoom, <kbd>f</kbd> ${model.states.needs.unmet}, <kbd>[</kbd> <kbd>]</kbd> scenario steps, <kbd>1</kbd>–<kbd>9</kbd> views, <kbd>esc</kbd> reset view.`;
  panel.appendChild(help);
  const reset = h("button", "orrery-reset", "Reset"); panel.appendChild(reset);
  fo.appendChild(panel);
  root.appendChild(fo);

  // ---- model evaluation ----
  const baseState = new Map<string, string>([...model.components.map((c) => [c.id, c.state] as const), ...model.groups.map((g) => [g.id, g.state] as const)]);
  const effective = (): Model => {
    const states = new Map<string, string>(), loads = new Map<string, number>();
    if (scenario) {
      const sc = model.scenarios.find((s) => s.id === scenario!.id)!;
      for (const st of sc.steps.slice(0, scenario.step)) {
        for (const [name, ids] of Object.entries(st.set)) for (const id of ids) states.set(id, name);
        for (const id of st.restore) states.set(id, baseState.get(id)!);
        for (const [k, v] of Object.entries(st.load)) loads.set(k, v);
      }
    }
    for (const [id, name] of overrides) states.set(id, name);
    const set: Record<string, string[]> = {};
    for (const [id, name] of states) set[name] = [...(set[name] ?? []), id];
    return propagate(applySet(model, set, Object.fromEntries(loads)));
  };

  const apply = () => {
    const d = effective();
    const entities = new Map<string, { state: string; reason?: string }>([...d.components.map((c) => [c.id, c] as const), ...d.groups.map((g) => [g.id, g] as const)]);
    const conns = new Map(d.connections.map((c) => [c.key, c]));
    for (const layer of layers.values()) {
      for (const g of layer.querySelectorAll<SVGGElement>("[data-node],[data-group]")) {
        const e = entities.get(g.getAttribute("data-node") ?? g.getAttribute("data-group")!);
        if (!e) continue;
        for (const cls of [...g.classList]) if (cls.startsWith("st-")) g.classList.remove(cls);
        g.classList.add(`st-${e.state}`);
        g.setAttribute("data-state", e.state);
        if (lookOf(e.state).pulse) g.setAttribute("data-pulse", "1"); else g.removeAttribute("data-pulse");
        let t: Element | null = g.querySelector(":scope > title");
        if (e.reason) { if (!t) { t = document.createElementNS("http://www.w3.org/2000/svg", "title"); g.insertBefore(t, g.firstChild); } t.textContent = e.reason; }
        else t?.remove();
      }
      for (const f of layer.querySelectorAll<SVGPathElement>("[data-flow]")) {
        const c = conns.get(f.getAttribute("data-flow")!);
        if (!c) continue;
        const oldLoad = Number(f.getAttribute("data-load"));
        if (oldLoad === c.load) continue;
        const anim = (f as unknown as { getAnimations?: () => { currentTime: number | null }[] }).getAnimations?.()[0];
        const delay = continuedDelay(anim?.currentTime ?? null, flowDuration(oldLoad) * 1000, flowDuration(c.load) * 1000);
        f.setAttribute("data-load", String(c.load));
        f.setAttribute("style", flowStyle(c.load) + (c.load > 0 && delay ? `;animation-delay:${Math.round(delay)}ms` : ""));
      }
    }
    for (const dot of outline.querySelectorAll<HTMLElement>("li .orrery-dot")) {
      const st = entities.get(dot.parentElement!.getAttribute("data-id")!)?.state ?? model.states.default;
      dot.setAttribute("data-state", st); dot.style.background = dotColor(st);
    }
    const sel = selected ? entities.get(selected.id)?.state : undefined;
    for (const b of stateBar.querySelectorAll<HTMLElement>("button")) b.classList.toggle("is-on", b.getAttribute("data-state") === sel);
    stepLbl.textContent = scenario ? `${scenario.step} / ${model.scenarios.find((s) => s.id === scenario!.id)!.steps.length}` : "";
    note.textContent = scenario ? (model.scenarios.find((s) => s.id === scenario!.id)!.steps[scenario.step - 1]!.note ?? "") : "";
  };

  // ---- camera ----
  const setCamera = (c: Camera, animate: boolean) => {
    if (tween) clearTimeout(tween);
    if (!animate) { camera = c; scene.setAttribute("transform", transformOf(c)); return; }
    const from = camera, start = Date.now(), dur = 300;
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / dur), e = 1 - Math.pow(1 - t, 3);
      camera = { k: from.k + (c.k - from.k) * e, tx: from.tx + (c.tx - from.tx) * e, ty: from.ty + (c.ty - from.ty) * e };
      scene.setAttribute("transform", transformOf(camera));
      if (t < 1) tween = setTimeout(step, 16); else { camera = c; scene.setAttribute("transform", transformOf(c)); }
    };
    step();
  };
  const layerSize = (id: string): Size => { const [w, hh] = (layers.get(id)!.getAttribute("data-size") ?? "1 1").split(" ").map(Number); return { width: w!, height: hh! }; };
  const fit = (animate: boolean) => setCamera(fitView(layerSize(activeId), screen(), frame()), animate);

  // ---- outline and selection ----
  const active = () => layers.get(activeId)!;
  const order: { id: string; type: "node" | "group" }[] = [];
  const rebuildOutline = () => {
    outline.innerHTML = ""; order.length = 0;
    const layer = active();
    const has = (sel: string) => layer.querySelector(sel) !== null;
    const groupIn = new Set(model.groups.filter((g) => has(`[data-group="${g.id}"]`)).map((g) => g.id));
    const isGhost = (id: string) => layer.querySelector(`[data-node="${id}"][data-ghost]`) !== null;
    const add = (id: string, type: "node" | "group", label: string, depth: number, state?: string) => {
      const li = h("li"); li.setAttribute("data-id", id); li.setAttribute("data-type", type); li.style.paddingLeft = `${6 + depth * 14}px`;
      const dot = h("span", "orrery-dot"); dot.setAttribute("data-state", state ?? model.states.default); dot.style.background = dotColor(state ?? model.states.default); li.appendChild(dot);
      li.appendChild(h("span", undefined, label));
      li.addEventListener("click", () => { select(id, type); zoomTo(id, type); });
      outline.appendChild(li); order.push({ id, type });
    };
    const walk = (parent: string | undefined, depth: number) => {
      for (const n of model.components) if (has(`[data-node="${n.id}"]`) && !isGhost(n.id) && (n.group === parent || (parent === undefined && (n.group === undefined || !groupIn.has(n.group))))) add(n.id, "node", n.label, depth, layer.querySelector(`[data-node="${n.id}"]`)!.getAttribute("data-state") ?? model.states.default);
      for (const g of model.groups) if (groupIn.has(g.id) && (g.parent === parent || (parent === undefined && (g.parent === undefined || !groupIn.has(g.parent))))) { add(g.id, "group", g.label, depth, layer.querySelector(`[data-group="${g.id}"]`)!.getAttribute("data-state") ?? model.states.default); walk(g.id, depth + 1); }
    };
    walk(undefined, 0);
  };
  const elOf = (id: string, type: "node" | "group") => active().querySelector<SVGGElement>(type === "node" ? `[data-node="${id}"]` : `[data-group="${id}"]`);
  const select = (id: string | null, type: "node" | "group" = "node") => {
    root.querySelectorAll(".is-selected").forEach((e) => e.classList.remove("is-selected"));
    outline.querySelectorAll(".is-active").forEach((e) => e.classList.remove("is-active"));
    selected = id ? { id, type } : null;
    if (!id) return;
    elOf(id, type)?.classList.add("is-selected");
    outline.querySelector(`li[data-id="${id}"]`)?.classList.add("is-active");
    const st = elOf(id, type)?.getAttribute("data-state");
    for (const b of stateBar.querySelectorAll<HTMLElement>("button")) b.classList.toggle("is-on", b.getAttribute("data-state") === st);
  };
  const zoomTo = (id: string, type: "node" | "group") => { const el = elOf(id, type); if (el) setCamera(zoomToBox(bbox(el), screen(), { ...frame(), maxZoom: type === "node" ? 2 : 1.5 }), true); };

  // ---- interactions ----
  const setState = (id: string, state: string) => { if (state === baseState.get(id)) overrides.delete(id); else overrides.set(id, state); apply(); };
  const toggle = (id: string, state: string) => setState(id, overrides.get(id) === state ? baseState.get(id)! : state);
  const cycle = (id: string) => { const cur = overrides.get(id) ?? baseState.get(id)!; setState(id, stateNames[(stateNames.indexOf(cur) + 1) % stateNames.length]!); };
  scene.addEventListener("click", (ev) => {
    const g = (ev.target as Element).closest?.("[data-node]:not([data-ghost]),[data-group]") as SVGGElement | null;
    if (!g) return;
    const id = g.getAttribute("data-node") ?? g.getAttribute("data-group")!;
    select(id, g.hasAttribute("data-node") ? "node" : "group");
    if ((ev as MouseEvent).shiftKey) cycle(id); else toggle(id, model.states.needs.unmet);
  });
  scene.addEventListener("mouseover", (ev) => {
    const g = (ev.target as Element).closest?.("[data-node]") as SVGGElement | null;
    const layer = active();
    layer.querySelectorAll(".is-hot").forEach((e) => e.classList.remove("is-hot"));
    layer.classList.toggle("has-hover", !!g);
    if (!g) return;
    const id = g.getAttribute("data-node")!;
    g.classList.add("is-hot");
    for (const e of model.connections) if (e.from === id || e.to === id) {
      layer.querySelector(`[data-edge="${e.key}"]`)?.classList.add("is-hot");
      layer.querySelector(`[data-flow="${e.key}"]`)?.classList.add("is-hot");
      layer.querySelector(`[data-node="${e.from === id ? e.to : e.from}"]`)?.classList.add("is-hot");
    }
  });
  scene.addEventListener("mouseleave", () => { const layer = active(); layer.classList.remove("has-hover"); layer.querySelectorAll(".is-hot").forEach((e) => e.classList.remove("is-hot")); });

  const setScenario = (id: string | null, step?: number) => {
    if (!id) scenario = null;
    else { const sc = model.scenarios.find((s) => s.id === id); if (!sc) return; scenario = { id, step: Math.min(Math.max(step ?? 1, 1), sc.steps.length) }; }
    scSel.value = id ?? "";
    apply();
  };
  scSel.addEventListener("change", () => setScenario(scSel.value || null, 1));
  prev.addEventListener("click", () => scenario && setScenario(scenario.id, scenario.step - 1));
  next.addEventListener("click", () => scenario && setScenario(scenario.id, scenario.step + 1));
  reset.addEventListener("click", () => doReset());
  const doReset = () => { overrides.clear(); scenario = null; scSel.value = ""; apply(); select(null); fit(true); };

  // ---- view switching with a morph ----
  const showView = (id: string) => {
    if (!layers.has(id) || id === activeId) return;
    const from = active(), to = layers.get(id)!;
    const moves: { el: SVGGElement; dx: number; dy: number; b: Box }[] = [];
    for (const g of from.querySelectorAll<SVGGElement>("[data-node]")) {
      const twin = to.querySelector<SVGGElement>(`[data-node="${g.getAttribute("data-node")}"]`);
      const b = bbox(g);
      if (twin) { const t = bbox(twin); moves.push({ el: g, dx: t.x - b.x, dy: t.y - b.y, b }); }
      else g.style.opacity = "0";
    }
    from.querySelectorAll<SVGElement>(".edges, .groups").forEach((e) => (e.style.opacity = "0"));
    const start = Date.now(), dur = 350;
    const finish = () => {
      for (const m of moves) m.el.setAttribute("transform", `translate(${m.b.x} ${m.b.y})`);
      from.querySelectorAll<SVGElement>("[style]").forEach((e) => (e.style.opacity = ""));
      from.style.display = "none"; to.style.display = "";
      activeId = id; viewSel.value = id;
      rebuildOutline(); apply();
      if (selected) select(selected.id, selected.type);
      fit(true);
    };
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / dur), e = 1 - Math.pow(1 - t, 3);
      for (const m of moves) m.el.setAttribute("transform", `translate(${m.b.x + m.dx * e} ${m.b.y + m.dy * e})`);
      if (t < 1) setTimeout(step, 16); else finish();
    };
    if (moves.length) step(); else finish();
  };
  viewSel.addEventListener("change", () => showView(viewSel.value));

  // ---- keyboard ----
  document.addEventListener("keydown", (ev) => {
    const k = ev.key;
    if ((ev.target as HTMLElement)?.tagName === "SELECT") return;
    if (k === "ArrowDown" || k === "ArrowUp") {
      ev.preventDefault();
      const i = selected ? order.findIndex((o) => o.id === selected!.id) : -1;
      const n = order[Math.min(order.length - 1, Math.max(0, i + (k === "ArrowDown" ? 1 : -1)))];
      if (n) select(n.id, n.type);
    } else if (k === "Enter" && selected) zoomTo(selected.id, selected.type);
    else if (k === "f" && selected) toggle(selected.id, model.states.needs.unmet);
    else if (k === "Escape") { select(null); fit(true); }
    else if (k === "[" && scenario) setScenario(scenario.id, scenario.step - 1);
    else if (k === "]" && scenario) setScenario(scenario.id, scenario.step + 1);
    else if (/^[1-9]$/.test(k)) { const id = [...layers.keys()][Number(k) - 1]; if (id) showView(id); }
  });
  if (typeof window !== "undefined") window.addEventListener("resize", () => fit(false));

  rebuildOutline(); apply(); fit(false);
  return { showView, setScenario, reset: doReset };
}

// Auto-boot when this script runs inside an Orrery SVG opened as a document.
if (typeof document !== "undefined") {
  const r = document.documentElement;
  if (r && r.getAttribute("data-orrery") === "1" && r.tagName.toLowerCase() === "svg" && !r.querySelector(".orrery-panel")) boot(r as unknown as SVGSVGElement);
}
