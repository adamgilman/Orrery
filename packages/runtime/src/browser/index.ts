import { flowDuration, flowStyle } from "@orrery/core/flow";
import { lookOf } from "@orrery/core/looks";
import type { Model } from "@orrery/core/types";
import { fitView, transformOf, zoomToBox, type Box, type Camera, type Size } from "./camera.js";
import { buildPanel, h, PANEL_W } from "./panel.js";
import { phaseOf } from "./phase.js";
import { Session } from "./session.js";

const MARGIN = 24;
const RUNTIME_CSS = `
.scene .node:not([data-ghost]),.scene .group{cursor:pointer}
.scene .node.is-selected .node-box{stroke:#2563eb;stroke-width:2.5;filter:drop-shadow(0 0 6px rgba(37,99,235,.45))}
.scene .group.is-selected .group-box{stroke:#2563eb;stroke-width:2}
.view.has-hover .node:not(.is-hot),.view.has-hover .edge:not(.is-hot),.view.has-hover .flow:not(.is-hot),.view.has-hover .edge-label:not(.is-hot){opacity:.18;transition:opacity .15s}
.node,.edge,.flow,.edge-label{transition:opacity .15s}
[data-lod]{transition:opacity .3s}`;

export interface BootOptions { size?: Size }
export interface Runtime {
  showView(id: string): void;
  setScenario(id: string | null, step?: number): void;
  setState(id: string, state: string): void;
  reset(): void;
  /** Remove the panel and every listener. */
  destroy(): void;
}
type EntityType = "node" | "group";

const bbox = (el: Element): Box => { const [x = 0, y = 0, width = 0, height = 0] = (el.getAttribute("data-bbox") ?? "").split(" ").map(Number); return { x, y, width, height }; };
const layerSize = (g: Element): Size => { const [width = 1, height = 1] = (g.getAttribute("data-size") ?? "").split(" ").map(Number); return { width, height }; };

export function boot(root: SVGSVGElement, opts: BootOptions = {}): Runtime {
  const modelText = root.querySelector("#orrery-model")?.textContent;
  if (!modelText) throw new Error("orrery: no embedded model");
  const model = JSON.parse(modelText) as Model;
  const session = new Session(model);
  const scene = root.querySelector<SVGGElement>(".scene")!;
  const layers = new Map([...root.querySelectorAll<SVGGElement>("g.view")].map((g) => [g.getAttribute("data-view")!, g]));
  const screen = (): Size => opts.size ?? { width: window.innerWidth, height: window.innerHeight };
  const frame = { left: PANEL_W, margin: MARGIN };
  const ac = new AbortController();
  const on = <T extends EventTarget>(t: T, type: string, fn: (ev: Event) => void) => t.addEventListener(type, fn, { signal: ac.signal });

  let activeId = [...layers].find(([, g]) => g.style.display !== "none")?.[0] ?? [...layers.keys()][0]!;
  let selected: { id: string; type: EntityType } | null = null;
  let camera: Camera = { k: 1, tx: 0, ty: 0 };
  let zoomed = false;
  let cameraTimer: ReturnType<typeof setTimeout> | undefined;
  let morphing: (() => void) | null = null;
  let autoplayTimer: ReturnType<typeof setInterval> | undefined;
  let sceneTimer: ReturnType<typeof setTimeout> | undefined;
  let sceneNote: string | undefined;
  let touring = false;
  const history: string[] = [];

  // A playing view ships every step as a CSS-cycled layer; the runtime plays steps itself, so keep the base only.
  for (const layer of layers.values()) {
    for (const step of layer.querySelectorAll<SVGGElement>("g.step")) {
      if (step.getAttribute("data-step") === "0") { step.removeAttribute("style"); step.querySelector(".step-note")?.remove(); } else step.remove();
    }
  }

  root.removeAttribute("viewBox");
  root.setAttribute("width", "100%"); root.setAttribute("height", "100%");
  root.style.background = "#fff";
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = RUNTIME_CSS;
  root.insertBefore(style, scene);
  const panel = buildPanel(model, [...layers].map(([id, g]) => ({ id, title: g.getAttribute("data-title") ?? id })));
  root.appendChild(panel.host);

  const dotColor = (state: string) => (state === model.states.default ? "#16a34a" : lookOf(model.states.define[state]!).stroke ?? "#94a3b8");
  const active = () => layers.get(activeId)!;
  const elOf = (id: string, type: EntityType) => active().querySelector<SVGGElement>(type === "node" ? `[data-node="${id}"]:not([data-ghost])` : `[data-group="${id}"]`);

  /* ---- write the effective model into every layer ---- */
  const apply = () => {
    const d = session.effective();
    const entities = new Map<string, { state: string; reason?: string }>([...d.components.map((c) => [c.id, c] as const), ...d.groups.map((g) => [g.id, g] as const)]);
    const conns = new Map(d.connections.map((c) => [c.key, c]));
    for (const layer of layers.values()) {
      for (const g of layer.querySelectorAll<SVGGElement>("[data-node],[data-group]")) {
        const e = entities.get(g.getAttribute("data-node") ?? g.getAttribute("data-group")!);
        if (!e) continue;
        for (const cls of [...g.classList]) if (cls.startsWith("st-")) g.classList.remove(cls);
        g.classList.add(`st-${e.state}`);
        g.setAttribute("data-state", e.state);
        if (lookOf(model.states.define[e.state]!).pulse) g.setAttribute("data-pulse", "1"); else g.removeAttribute("data-pulse");
        let t: Element | null = g.querySelector(":scope > title");
        if (e.reason) { if (!t) { t = document.createElementNS("http://www.w3.org/2000/svg", "title"); g.insertBefore(t, g.firstChild); } t.textContent = e.reason; }
        else t?.remove();
      }
      for (const f of layer.querySelectorAll<SVGPathElement>("[data-flow]")) {
        const c = conns.get(f.getAttribute("data-flow")!);
        if (!c) continue;
        const oldLoad = Number(f.getAttribute("data-load"));
        if (oldLoad === c.load) continue;
        // Keep the dash phase across the duration change so the flow never jumps.
        const ct = f.getAnimations?.()[0]?.currentTime;
        const phase = phaseOf(typeof ct === "number" ? ct : null, flowDuration(oldLoad) * 1000);
        f.setAttribute("data-load", String(c.load));
        f.setAttribute("style", flowStyle(c.load));
        const next = f.getAnimations?.()[0];
        if (next && c.load > 0) next.currentTime = phase * flowDuration(c.load) * 1000;
      }
    }
    for (const dot of panel.outline.querySelectorAll<HTMLElement>("li .orrery-dot")) {
      const st = entities.get(dot.parentElement!.getAttribute("data-id")!)?.state ?? model.states.default;
      dot.style.background = dotColor(st);
    }
    syncStateBar();
    panel.step.textContent = session.scenario ? `${session.scenario.step} / ${session.stepCount()}` : "";
    panel.note.textContent = sceneNote ?? session.note();
    panel.prev.disabled = !session.scenario || session.scenario.step <= 1;
    panel.next.disabled = !session.scenario || session.scenario.step >= session.stepCount();
  };
  /** The state bar shows the selected entity's declared state (what a click would change), not its derived one. */
  const syncStateBar = () => {
    const cur = selected ? session.current(selected.id) : undefined;
    for (const b of panel.stateBar.querySelectorAll<HTMLElement>("button")) b.classList.toggle("is-on", b.getAttribute("data-state") === cur);
  };

  /* ---- camera ---- */
  const tween = (to: Camera, animate: boolean) => {
    if (cameraTimer) clearTimeout(cameraTimer);
    if (!animate) { camera = to; scene.setAttribute("transform", transformOf(to)); return; }
    const from = camera, start = Date.now(), dur = 300;
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / dur), e = 1 - Math.pow(1 - t, 3);
      camera = t < 1 ? { k: from.k + (to.k - from.k) * e, tx: from.tx + (to.tx - from.tx) * e, ty: from.ty + (to.ty - from.ty) * e } : to;
      scene.setAttribute("transform", transformOf(camera));
      if (t < 1) cameraTimer = setTimeout(step, 16);
    };
    step();
  };
  const fit = (animate: boolean) => { zoomed = false; tween(fitView(layerSize(active()), screen(), frame), animate); };
  const zoomTo = (id: string, type: EntityType) => { const el = elOf(id, type); if (el) { zoomed = true; tween(zoomToBox(bbox(el), screen(), { ...frame, maxZoom: type === "node" ? 2 : 4 }), true); } };

  /* ---- outline and selection ---- */
  const order: { id: string; type: EntityType }[] = [];
  const rebuildOutline = () => {
    panel.outline.innerHTML = ""; order.length = 0;
    const layer = active();
    const shown = (id: string) => layer.querySelector(`[data-node="${id}"]:not([data-ghost]),[data-group="${id}"]`) !== null;
    const groupIn = new Set(model.groups.filter((g) => shown(g.id)).map((g) => g.id));
    const topLevel = (parent: string | undefined, container: string | undefined) => container === parent || (parent === undefined && (container === undefined || !groupIn.has(container)));
    const add = (id: string, type: EntityType, label: string, depth: number) => {
      const li = h("li"); li.setAttribute("data-id", id); li.setAttribute("data-type", type); li.style.paddingLeft = `${6 + depth * 14}px`;
      const dot = h("span", "orrery-dot"); li.appendChild(dot);
      li.appendChild(h("span", undefined, label));
      on(li, "click", () => { select(id, type); zoomTo(id, type); });
      panel.outline.appendChild(li); order.push({ id, type });
    };
    const walk = (parent: string | undefined, depth: number) => {
      for (const c of model.components) if (shown(c.id) && topLevel(parent, c.group)) add(c.id, "node", c.label, depth);
      for (const g of model.groups) if (groupIn.has(g.id) && topLevel(parent, g.parent)) { add(g.id, "group", g.label, depth); walk(g.id, depth + 1); }
    };
    walk(undefined, 0);
  };
  const select = (id: string | null, type: EntityType = "node") => {
    root.querySelectorAll(".is-selected").forEach((e) => e.classList.remove("is-selected"));
    panel.outline.querySelectorAll(".is-active").forEach((e) => e.classList.remove("is-active"));
    selected = id ? { id, type } : null;
    if (id) { elOf(id, type)?.classList.add("is-selected"); panel.outline.querySelector(`li[data-id="${id}"]`)?.classList.add("is-active"); }
    syncStateBar();
  };

  /* ---- interactions ---- */
  const setState = (id: string, state: string) => { session.set(id, state); apply(); };
  /** Level of detail: a closed group in focus shows its members instead of its summary; the camera closes on it. */
  let focusId: string | null = null;
  const setOpen = (groupId: string, open: boolean) => {
    for (const layer of layers.values()) for (const el of layer.querySelectorAll<SVGElement>(`[data-lod][data-for~="${groupId}"]`))
      el.style.opacity = (el.getAttribute("data-lod") === "detail") === open ? "1" : "0";
  };
  const resolve = (groupId: string | null) => { for (const g of model.groups) setOpen(g.id, g.id === groupId); };
  let resolveTimer: ReturnType<typeof setTimeout> | undefined;
  /** As in the file's own tour: the camera moves over an unchanging picture, and the level of detail resolves once it has settled. */
  const focus = (groupId: string | null, animate = true) => {
    focusId = groupId;
    if (resolveTimer) clearTimeout(resolveTimer);
    if (groupId) zoomTo(groupId, "group"); else fit(animate);
    resolveTimer = setTimeout(() => resolve(groupId), animate ? 300 : 0);
  };
  /** Clicking a closed group focuses it. */
  const drillInto = (groupId: string): boolean => {
    if (!active().querySelector(`[data-group="${groupId}"][data-collapsed]`)) return false;
    history.push(focusId ?? "");
    focus(groupId);
    return true;
  };
  on(scene, "click", (ev) => {
    let g = (ev.target as Element).closest?.("[data-node]:not([data-ghost]),[data-group]") as SVGGElement | null;
    if (!g) return;
    // Hidden detail is not clickable: a click on a member of a closed, unfocused group is a click on the group.
    const hiddenIn = g.getAttribute("data-lod") === "detail" ? (g.getAttribute("data-for") ?? "").split(" ")[0] : undefined;
    if (hiddenIn && hiddenIn !== focusId) g = active().querySelector<SVGGElement>(`[data-group="${hiddenIn}"]`) ?? g;
    const id = g.getAttribute("data-node") ?? g.getAttribute("data-group")!;
    if (g.hasAttribute("data-collapsed") && !(ev as MouseEvent).shiftKey && focusId !== id && drillInto(id)) return;
    select(id, g.hasAttribute("data-node") ? "node" : "group");
    if ((ev as MouseEvent).shiftKey) session.cycle(id); else session.toggle(id, model.states.needs.unmet);
    apply();
  });
  on(scene, "mouseover", (ev) => {
    const g = (ev.target as Element).closest?.("[data-node]") as SVGGElement | null;
    const layer = active();
    layer.querySelectorAll(".is-hot").forEach((e) => e.classList.remove("is-hot"));
    layer.classList.toggle("has-hover", !!g);
    if (!g) return;
    const id = g.getAttribute("data-node")!;
    g.classList.add("is-hot");
    for (const c of model.connections) if (c.from === id || c.to === id) {
      layer.querySelectorAll(`[data-edge="${c.key}"],[data-flow="${c.key}"]`).forEach((e) => e.classList.add("is-hot")); // both levels of detail
      layer.querySelector(`[data-node="${c.from === id ? c.to : c.from}"]`)?.classList.add("is-hot");
    }
  });
  on(scene, "mouseleave", () => { const layer = active(); layer.classList.remove("has-hover"); layer.querySelectorAll(".is-hot").forEach((e) => e.classList.remove("is-hot")); });
  for (const b of panel.stateBar.querySelectorAll<HTMLButtonElement>("button")) on(b, "click", () => { if (selected) setState(selected.id, b.getAttribute("data-state")!); });

  const setScenario = (id: string | null, step = 1) => { session.setScenario(id, step); panel.scenarios.value = session.scenario?.id ?? ""; apply(); };

  /** Play the active view's scenario on its timer: base, each step, loop. Any interaction stops it. */
  const stopAutoplay = () => { touring = false; sceneNote = undefined; if (autoplayTimer) { clearInterval(autoplayTimer); autoplayTimer = undefined; } if (sceneTimer) { clearTimeout(sceneTimer); sceneTimer = undefined; } };
  /** Play the model's scenes on their timers with the morph: view, scenario moment, overrides, caption. Any interaction stops it. */
  const startTour = () => {
    stopAutoplay();
    const tour = model.tour;
    if (!tour) return;
    touring = true;
    const play = (k: number) => {
      const sc = tour.scenes[k]!;
      showView(sc.view, true);
      session.replaceOverrides(sc.set);
      session.setScenario(sc.scenario ?? null, sc.step ?? (sc.scenario ? model.scenarios.find((s) => s.id === sc.scenario)!.steps.length : 1));
      panel.scenarios.value = session.scenario?.id ?? "";
      sceneNote = sc.note;
      apply();
      if ((sc.focus ?? null) !== focusId) focus(sc.focus ?? null);
      sceneTimer = setTimeout(() => play((k + 1) % tour.scenes.length), sc.seconds * 1000);
    };
    play(0);
  };
  const startAutoplay = () => {
    if (touring) return;
    stopAutoplay();
    const play = model.views.find((v) => v.id === activeId)?.play;
    if (!play) return;
    const n = model.scenarios.find((s) => s.id === play.scenario)?.steps.length ?? 0;
    if (!n) return;
    let k = 0;
    setScenario(null);
    autoplayTimer = setInterval(() => { k = (k + 1) % (n + 1); setScenario(k === 0 ? null : play.scenario, k); }, play.seconds * 1000);
  };
  for (const t of [scene, panel.host]) on(t, "click", stopAutoplay);
  on(document, "keydown", stopAutoplay);
  on(panel.scenarios, "change", stopAutoplay);
  on(panel.views, "change", stopAutoplay);
  on(panel.scenarios, "change", () => setScenario(panel.scenarios.value || null, 1));
  on(panel.prev, "click", () => session.scenario && setScenario(session.scenario.id, session.scenario.step - 1));
  on(panel.next, "click", () => session.scenario && setScenario(session.scenario.id, session.scenario.step + 1));
  const reset = () => { session.reset(); panel.scenarios.value = ""; apply(); select(null); fit(true); };
  on(panel.reset, "click", reset);

  /* ---- view switching with a morph: shared components slide, the rest fades ---- */
  const showView = (id: string, byTour = false) => {
    if (!layers.has(id) || id === activeId) return;
    if (!byTour) stopAutoplay();
    if (morphing) morphing();
    const from = active(), to = layers.get(id)!;
    const moves: { el: SVGGElement; dx: number; dy: number; b: Box }[] = [];
    for (const g of from.querySelectorAll<SVGGElement>("[data-node]")) {
      const twin = to.querySelector<SVGGElement>(`[data-node="${g.getAttribute("data-node")}"]`);
      const b = bbox(g);
      if (twin) { const t = bbox(twin); moves.push({ el: g, dx: t.x - b.x, dy: t.y - b.y, b }); } else g.style.opacity = "0";
    }
    // Groups present in both views grow or shrink their frame: a closed box opens into the frame it stands for.
    const frames: { rect: SVGRectElement; a: Box; b: Box }[] = [];
    for (const g of from.querySelectorAll<SVGGElement>("[data-group]")) {
      const twin = to.querySelector<SVGGElement>(`[data-group="${g.getAttribute("data-group")}"]`);
      const rect = g.querySelector<SVGRectElement>(".group-box");
      if (twin && rect) { frames.push({ rect, a: bbox(g), b: bbox(twin) }); g.querySelectorAll<SVGElement>("text").forEach((t) => (t.style.opacity = "0")); }
      else g.style.opacity = "0";
    }
    from.querySelectorAll<SVGElement>(".edges, .legend").forEach((e) => (e.style.opacity = "0"));
    const start = Date.now(), dur = 350;
    let handle: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (handle) clearTimeout(handle);
      morphing = null;
      for (const m of moves) m.el.setAttribute("transform", `translate(${m.b.x} ${m.b.y})`);
      for (const f of frames) { f.rect.setAttribute("x", String(f.a.x)); f.rect.setAttribute("y", String(f.a.y)); f.rect.setAttribute("width", String(f.a.width)); f.rect.setAttribute("height", String(f.a.height)); }
      from.querySelectorAll<SVGElement>("[style]").forEach((e) => (e.style.opacity = ""));
      from.style.display = "none"; to.style.display = "";
      activeId = id; panel.views.value = id;
      rebuildOutline(); apply();
      if (selected) select(selected.id, selected.type);
      fit(true);
      startAutoplay();
    };
    morphing = finish;
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / dur), e = 1 - Math.pow(1 - t, 3);
      for (const m of moves) m.el.setAttribute("transform", `translate(${m.b.x + m.dx * e} ${m.b.y + m.dy * e})`);
      for (const f of frames) {
        const lerp = (p: number, q: number) => p + (q - p) * e;
        f.rect.setAttribute("x", String(lerp(f.a.x, f.b.x))); f.rect.setAttribute("y", String(lerp(f.a.y, f.b.y)));
        f.rect.setAttribute("width", String(lerp(f.a.width, f.b.width))); f.rect.setAttribute("height", String(lerp(f.a.height, f.b.height)));
      }
      if (t < 1) handle = setTimeout(step, 16); else finish();
    };
    if (moves.length || frames.length) step(); else finish();
  };
  on(panel.views, "change", () => showView(panel.views.value));

  /* ---- keyboard ---- */
  on(document, "keydown", (ev) => {
    const k = (ev as KeyboardEvent).key;
    if ((ev as KeyboardEvent).metaKey || (ev as KeyboardEvent).ctrlKey || (ev as KeyboardEvent).altKey) return;
    if ((ev.target as Element)?.closest?.("select,button,input,textarea")) return;
    let handled = true;
    if (k === "ArrowDown" || k === "ArrowUp") {
      const i = selected ? order.findIndex((o) => o.id === selected!.id) : -1;
      const n = order[Math.min(order.length - 1, Math.max(0, i + (k === "ArrowDown" ? 1 : -1)))];
      if (n) select(n.id, n.type);
    } else if (k === "Enter" && selected) zoomTo(selected.id, selected.type);
    else if (k === "f" && selected) { session.toggle(selected.id, model.states.needs.unmet); apply(); }
    else if (k === "Escape") { if (history.length) { const back = history.pop()!; focus(back || null); } else { select(null); if (focusId) focus(null); else fit(true); } }
    else if (k === "[" && session.scenario) setScenario(session.scenario.id, session.scenario.step - 1);
    else if (k === "]" && session.scenario) setScenario(session.scenario.id, session.scenario.step + 1);
    else if (/^[1-9]$/.test(k)) { const id = [...layers.keys()][Number(k) - 1]; if (id) showView(id); }
    else handled = false;
    if (handled) ev.preventDefault();
  });
  on(window, "resize", () => { if (!zoomed) fit(false); });

  rebuildOutline(); apply(); resolve(null); fit(false); if (model.tour) startTour(); else startAutoplay();
  return {
    showView, setScenario, setState, reset,
    destroy: () => { ac.abort(); stopAutoplay(); if (cameraTimer) clearTimeout(cameraTimer); if (resolveTimer) clearTimeout(resolveTimer); if (morphing) morphing(); panel.host.remove(); style.remove(); },
  };
}

// Auto-boot when this script runs inside an Orrery SVG opened as a document.
if (typeof document !== "undefined") {
  const r = document.documentElement;
  if (r && r.getAttribute("data-orrery") === "1" && r.tagName.toLowerCase() === "svg" && !r.querySelector(".orrery-panel")) boot(r as unknown as SVGSVGElement);
}
