import { flowDuration, flowStyle } from "@orrery-diagrams/core/internal/flow";
import { lookOf } from "@orrery-diagrams/core/internal/looks";
import { scalePath } from "@orrery-diagrams/core/internal/shapes";
import type { Model } from "@orrery-diagrams/core/types";
import { fitView, transformOf, zoomToBox, type Box, type Camera, type Size } from "./camera.js";
import { phaseOf } from "./phase.js";
import { Session } from "./session.js";

const MARGIN = 24;
const RUNTIME_CSS = `
.scene .node:not([data-ghost]),.scene .group{cursor:pointer}
.scene .node.is-selected .node-box{stroke:#2563eb;stroke-width:2.5;filter:drop-shadow(0 0 6px rgba(37,99,235,.45))}
.scene .group.is-selected .group-box{stroke:#2563eb;stroke-width:2}
.view.has-hover .node:not(.is-hot),.view.has-hover .edge:not(.is-hot),.view.has-hover .flow:not(.is-hot),.view.has-hover .edge-label:not(.is-hot){opacity:.18;transition:opacity .15s}
.node,.edge,.flow,.edge-label{transition:opacity .15s}
.strip{touch-action:manipulation;-webkit-user-select:none;user-select:none}
.strip [data-do]{cursor:pointer}
.strip .off{opacity:.3;pointer-events:none}
.strip .key{fill:#fff;stroke:#cbd5e1}
.strip path{fill:none;stroke:#334155;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
`;

export interface MountOptions {
  size?: Size;
  /**
   * Draw the strip (R19): the current view, scenario step and note along the bottom edge, with tap targets to step
   * them. The file opened on its own asks for it, since a reader there may have no keyboard; a page leaves it off
   * and brings its own controls.
   */
  controls?: boolean;
}
/** One line of the strip: what it says, and what its previous and next targets do. */
interface StripRow { name: string; text(): string; can(by: number): boolean; step(by: number): void; leave?: () => void }
const ROW = 44; // a tap target's side, and a strip row's height
const WIDE = 720; // from this width the strip's rows sit side by side
const GLYPH = { prev: "M25 15l-7 7 7 7", next: "M19 15l7 7-7 7", leave: "M16 16l12 12M28 16l-12 12" };
const SAYS = { prev: "Previous", next: "Next", leave: "Leave the scenario" };
const wrap = (text: string, perLine: number): string[] => {
  const lines: string[] = [];
  for (const w of text.split(" ")) { const last = lines[lines.length - 1]; if (last !== undefined && last.length + 1 + w.length <= perLine) lines[lines.length - 1] = `${last} ${w}`; else lines.push(w); }
  return lines;
};

/** What the diagram shows right now. Emitted after every change; enough to build any control from. */
export interface Snapshot {
  view: string;
  /** Closed groups drawn open, in declaration order. */
  open: string[];
  /** What the camera is closed on, or null for the whole picture. */
  zoom: string | null;
  scenario: { id: string; step: number; steps: number; note?: string } | null;
  /** On a sequence view: how many of its messages are shown, and how many there are (R17). */
  message: { index: number; count: number } | null;
  /** Every entity, as drawn. */
  states: Record<string, { state: string; reason?: string }>;
  selected: string | null;
  playing: boolean;
}

/**
 * The engine's interface: what a page builds its controls from and calls. The engine has no user interface of its
 * own; inside the diagram, clicks and the keyboard keep working with no page code at all: click to select, click a
 * closed box to open it, double-click or Enter to zoom, Escape to zoom out then close, arrows select, s cycles
 * scenarios, [ and ] step one, digits switch views (MODEL.md R11, the spec
 * docs/design/notes/2026-09-05-two-paths-design.md). The file opened on its own also draws the strip (R19), so
 * the author's views and scenario steps are reachable by tap. No gesture inside the diagram changes a state:
 * `setState` and `cycle` are for a page's own controls.
 */
export interface Orrery {
  readonly views: { id: string; title: string }[];
  readonly scenarios: { id: string; label: string; steps: number }[];
  readonly states: { name: string; description?: string }[];
  /** Groups drawn in the current layout: `closable` ones can be opened and closed; `open` says which are. */
  groups(): { id: string; label: string; closable: boolean; open: boolean }[];
  showView(id: string): void;
  /**
   * Set exactly which closed groups are open (a group inside another closed group needs that one listed too; any
   * other set is refused and returns false). The picture moves to that layout; the camera keeps its zoom if the
   * target is still drawn, else fits. Opening and zooming are separate actions.
   */
  open(groupIds: readonly string[]): boolean;
  /** Close the camera on an entity drawn in the current layout, or `null` to fit the whole picture. */
  zoom(id: string | null): void;
  /** One step back: zoomed → fit; else close the innermost open group; false when there is nothing to undo. */
  back(): boolean;
  setScenario(id: string | null, step?: number): void;
  next(): void;
  prev(): void;
  setState(id: string, state: string): void;
  /** Step an entity through the author's states in definition order; `by` -1 steps back. */
  cycle(id: string, by?: number): void;
  reset(): void;
  select(id: string | null): void;
  zoomTo(id: string): void;
  fit(): void;
  /** Play the model's tour if it has one, else the current view's scenario. Any interaction stops it. */
  play(): void;
  stop(): void;
  on(event: "change", fn: (s: Snapshot) => void): () => void;
  snapshot(): Snapshot;
  /** Remove every listener and timer; the diagram stays as it is. */
  destroy(): void;
}
type EntityType = "node" | "group";

const bbox = (el: Element): Box => { const [x = 0, y = 0, width = 0, height = 0] = (el.getAttribute("data-bbox") ?? "").split(" ").map(Number); return { x, y, width, height }; };
const layerSize = (g: Element): Size => { const [width = 1, height = 1] = (g.getAttribute("data-size") ?? "").split(" ").map(Number); return { width, height }; };

export function mount(root: SVGSVGElement, opts: MountOptions = {}): Orrery {
  const modelText = root.querySelector("#orrery-model")?.textContent;
  if (!modelText) throw new Error("orrery: no embedded model");
  const model = JSON.parse(modelText) as Model;
  const session = new Session(model);
  const scene = root.querySelector<SVGGElement>(".scene")!;
  // One layer per view and per set of open groups (`data-open`): opening and closing is a morph between two of them.
  const layerKey = (view: string, open: string) => `${view}|${open}`;
  const layers = new Map([...root.querySelectorAll<SVGGElement>("g.view")].map((g) => [layerKey(g.getAttribute("data-view")!, g.getAttribute("data-open") ?? ""), g]));
  const viewIds = [...new Set([...root.querySelectorAll<SVGGElement>("g.view")].map((g) => g.getAttribute("data-view")!))];
  const parentOf = new Map(model.groups.map((g) => [g.id, g.parent] as const));
  const groupOrder = new Map(model.groups.map((g, i) => [g.id, i] as const));
  const collapseOf = (viewId: string) => model.views.find((v) => v.id === viewId)?.collapse ?? [];
  /** A valid open set for a view, in declaration order, or null: every id closable, and its closed ancestors open too. */
  const canonical = (viewId: string, ids: readonly string[]): string[] | null => {
    const closed = new Set(collapseOf(viewId)), set = new Set(ids);
    for (const id of ids) {
      if (!closed.has(id)) return null;
      for (let cur = parentOf.get(id); cur !== undefined; cur = parentOf.get(cur)) if (closed.has(cur) && !set.has(cur)) return null;
    }
    return [...set].sort((a, b) => (groupOrder.get(a) ?? 0) - (groupOrder.get(b) ?? 0));
  };
  // The space the diagram has: the option, else the element's own box (an embed on a page), else the window.
  const screen = (): Size => { if (opts.size) return opts.size; const r = root.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? { width: r.width, height: r.height } : { width: window.innerWidth, height: window.innerHeight }; };
  const frame = { margin: MARGIN };
  const ac = new AbortController();
  const on = <T extends EventTarget>(t: T, type: string, fn: (ev: Event) => void) => t.addEventListener(type, fn, { signal: ac.signal });

  let activeKey = [...layers].find(([, g]) => g.style.display !== "none")?.[0] ?? [...layers.keys()][0]!;
  const activeId = () => activeKey.split("|")[0]!;
  let selected: { id: string; type: EntityType } | null = null;
  let camera: Camera = { k: 1, tx: 0, ty: 0 };
  let cameraTimer: ReturnType<typeof setTimeout> | undefined;
  let morphing: (() => void) | null = null;
  let destroyed = false; // after destroy nothing may start a timer, whatever callback is still unwinding
  let autoplayTimer: ReturnType<typeof setInterval> | undefined;
  let sceneTimer: ReturnType<typeof setTimeout> | undefined;
  let sceneNote: string | undefined;
  let playing = false;
  let openSet: string[] = [];
  let zoomId: string | null = null;
  const listeners = new Set<(s: Snapshot) => void>();
  let stripHeight = 0;
  let drawStrip = () => {};

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

  const active = () => layers.get(activeKey)!;
  const elOf = (id: string, type: EntityType) => active().querySelector<SVGGElement>(type === "node" ? `[data-node="${id}"]:not([data-ghost])` : `[data-group="${id}"]`);
  const typeOf = (id: string): EntityType => (model.groups.some((g) => g.id === id) ? "group" : "node");

  /* ---- sequence views: the messages of the active layer, revealed so far (R17) ---- */
  const isSequence = () => model.views.find((v) => v.id === activeId())?.type === "sequence";
  const messagesOf = () => [...active().querySelectorAll<SVGGElement>(".message")];
  let revealed: number | null = null;
  const showMessages = (n: number | null) => { revealed = n; messagesOf().forEach((m, i) => (m.style.display = n === null || i < n ? "" : "none")); };
  const setMessage = (n: number, byPlayer = false) => { if (!byPlayer) stop(); showMessages(Math.min(Math.max(n, 0), messagesOf().length)); emit(); };
  // the file reveals messages with CSS; the runtime does it itself
  for (const layer of layers.values()) for (const m of layer.querySelectorAll<SVGGElement>(".message")) { m.removeAttribute("style"); m.removeAttribute("data-t0"); }

  /* ---- the snapshot, and telling the page ---- */
  let lastEffective = session.effective();
  const snapshot = (): Snapshot => {
    const states: Snapshot["states"] = {};
    for (const e of [...lastEffective.components, ...lastEffective.groups]) states[e.id] = { state: e.state, ...(e.reason !== undefined ? { reason: e.reason } : {}) };
    const sc = session.scenario;
    const note = sceneNote ?? session.note();
    return {
      view: activeId(), open: [...openSet], zoom: zoomId,
      scenario: sc ? { id: sc.id, step: sc.step, steps: session.stepCount(), ...(note ? { note } : {}) } : null,
      message: isSequence() ? { index: revealed ?? messagesOf().length, count: messagesOf().length } : null,
      states, selected: selected?.id ?? null, playing,
    };
  };
  const emit = () => { drawStrip(); const s = snapshot(); for (const fn of listeners) fn(s); };

  /* ---- write the effective model into every layer ---- */
  const apply = () => {
    const d = (lastEffective = session.effective());
    const entities = new Map<string, { state: string; reason?: string }>([...d.components.map((c) => [c.id, c] as const), ...d.groups.map((g) => [g.id, g] as const)]);
    const conns = new Map(d.connections.map((c) => [c.key, c]));
    for (const layer of layers.values()) {
      // The current step's callouts show; every other step's stay hidden (R16).
      for (const g of layer.querySelectorAll<SVGGElement>(".callouts-step")) g.style.display = session.scenario && g.getAttribute("data-scenario") === session.scenario.id && Number(g.getAttribute("data-step")) === session.scenario.step ? "" : "none";
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
    emit();
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
  // A heading block (R15) sits above the scene; the camera works in the screen below it.
  const inset = Number(root.getAttribute("data-heading") ?? 0);
  const stage = (): Size => { const s = screen(); return { width: s.width, height: s.height - inset - stripHeight }; };
  const below = (c: Camera): Camera => ({ ...c, ty: c.ty + inset });
  const fit = (animate: boolean) => { zoomId = null; tween(below(fitView(layerSize(active()), stage(), frame)), animate); };
  const zoomTo = (id: string, type: EntityType, animate = true): boolean => { const el = elOf(id, type); if (!el) return false; zoomId = id; tween(below(zoomToBox(bbox(el), stage(), { ...frame, maxZoom: type === "node" ? 2 : 4 })), animate); return true; };

  /* ---- selection: the entities of the active layer, in outline order (components first, then groups and what they hold) ---- */
  const order: { id: string; type: EntityType }[] = [];
  const rebuildOrder = () => {
    order.length = 0;
    const layer = active();
    const shown = (id: string) => layer.querySelector(`[data-node="${id}"]:not([data-ghost]),[data-group="${id}"]`) !== null;
    const groupIn = new Set(model.groups.filter((g) => shown(g.id)).map((g) => g.id));
    const topLevel = (parent: string | undefined, container: string | undefined) => container === parent || (parent === undefined && (container === undefined || !groupIn.has(container)));
    const walk = (parent: string | undefined) => {
      for (const c of model.components) if (shown(c.id) && topLevel(parent, c.group)) order.push({ id: c.id, type: "node" });
      for (const g of model.groups) if (groupIn.has(g.id) && topLevel(parent, g.parent)) { order.push({ id: g.id, type: "group" }); walk(g.id); }
    };
    walk(undefined);
  };
  const select = (id: string | null, type: EntityType = "node") => {
    root.querySelectorAll(".is-selected").forEach((e) => e.classList.remove("is-selected"));
    selected = id ? { id, type } : null;
    if (id) elOf(id, type)?.classList.add("is-selected");
  };

  /* ---- playing: the tour, or the view's scenario, until the first interaction ---- */
  const stop = () => {
    const was = playing;
    playing = false; sceneNote = undefined;
    if (autoplayTimer) { clearInterval(autoplayTimer); autoplayTimer = undefined; if (isSequence() && revealed !== null) showMessages(null); } // a stopped sequence is the still: every message
    if (sceneTimer) { clearTimeout(sceneTimer); sceneTimer = undefined; }
    if (was) emit();
  };
  const playTour = () => {
    if (destroyed) return;
    const tour = { scenes: model.tour!.scenes.filter((sc) => layers.has(layerKey(sc.view, ""))) }; // a sequence scene lives in its own file
    if (!tour.scenes.length) return;
    playing = true;
    const scene = (k: number) => {
      const sc = tour.scenes[k]!;
      sceneTimer = setTimeout(() => scene((k + 1) % tour.scenes.length), sc.seconds * 1000);
      // the scene's view first, then its moment, open groups and zoom in that view, once the view is shown
      const rest = () => {
        session.replaceOverrides(sc.set);
        session.setScenario(sc.scenario ?? null, sc.step ?? (sc.scenario ? model.scenarios.find((s) => s.id === sc.scenario)!.steps.length : 1));
        sceneNote = sc.note;
        const target = canonical(activeId(), sc.open ?? []) ?? [];
        const zoomThen = () => { if (sc.zoom) zoomTo(sc.zoom, typeOf(sc.zoom)); else fit(true); apply(); };
        if (target.join(" ") !== openSet.join(" ")) openTo(target, zoomThen, true); else zoomThen();
      };
      if (sc.view !== activeId() && showView(sc.view, true, rest)) return;
      rest();
    };
    scene(0);
  };
  const playScenario = () => {
    if (destroyed) return;
    const play = model.views.find((v) => v.id === activeId())?.play;
    if (!play?.scenario) return;
    const n = model.scenarios.find((s) => s.id === play.scenario)?.steps.length ?? 0;
    if (!n) return;
    playing = true;
    let k = 0;
    setScenario(null, 1, true);
    autoplayTimer = setInterval(() => { k = (k + 1) % (n + 1); setScenario(k === 0 ? null : play.scenario!, k, true); }, play.seconds * 1000);
  };
  const playMessages = () => {
    if (destroyed) return;
    const seconds = model.views.find((v) => v.id === activeId())?.play?.seconds ?? 1;
    playing = true;
    showMessages(0);
    autoplayTimer = setInterval(() => { const n = (revealed ?? 0) + 1; showMessages(n > messagesOf().length ? 0 : n); emit(); }, seconds * 1000);
  };
  const play = () => { stop(); if (model.tour) playTour(); else if (isSequence()) playMessages(); else playScenario(); };

  /* ---- what the interface does ---- */
  const setState = (id: string, state: string) => { stop(); session.set(id, state); apply(); };
  const cycle = (id: string, by = 1) => { stop(); session.cycle(id, by); apply(); };
  const setScenario = (id: string | null, step = 1, byPlayer = false) => { if (!byPlayer) stop(); session.setScenario(id, step); apply(); };
  const reset = () => { stop(); session.reset(); select(null); if (isSequence()) showMessages(null); if (openSet.length) openTo([], () => { fit(true); apply(); }); else { apply(); fit(true); } };

  /** Opening and closing (R11): the layer with exactly that set of open groups shows, by a morph; the camera keeps its zoom if the target is still drawn, else fits. */
  const openTo = (target: string[], after: () => void, byPlayer = false) => {
    if (!byPlayer) stop();
    const key = layerKey(activeId(), target.join(" "));
    if (!layers.has(key)) return;
    openSet = target;
    if (key === activeKey) after(); else morphTo(key, after);
  };
  const open = (ids: readonly string[]): boolean => {
    const target = canonical(activeId(), ids);
    if (!target) return false;
    openTo(target, () => { if (!(zoomId && zoomTo(zoomId, typeOf(zoomId)))) fit(true); apply(); });
    return true;
  };
  const zoom = (id: string | null) => { stop(); if (id === null) fit(true); else zoomTo(id, typeOf(id)); emit(); };
  const back = (): boolean => {
    if (zoomId) { zoom(null); return true; }
    if (openSet.length) { const innermost = openSet[openSet.length - 1]!; open(openSet.filter((g) => g !== innermost && !isInside(g, innermost))); return true; }
    return false;
  };
  const isInside = (id: string, groupId: string) => { for (let cur = parentOf.get(id); cur !== undefined; cur = parentOf.get(cur)) if (cur === groupId) return true; return false; };

  /* ---- switching layers with a morph: shared components slide, frames resize, the rest fades ---- */
  const morphTo = (key: string, after: () => void) => {
    if (morphing) morphing();
    const from = active(), to = layers.get(key)!;
    const moves: { el: SVGGElement; dx: number; dy: number; b: Box }[] = [];
    for (const g of from.querySelectorAll<SVGGElement>("[data-node]")) {
      const twin = to.querySelector<SVGGElement>(`[data-node="${g.getAttribute("data-node")}"]`);
      const b = bbox(g);
      if (twin) { const t = bbox(twin); moves.push({ el: g, dx: t.x - b.x, dy: t.y - b.y, b }); } else g.style.opacity = "0";
    }
    // Groups present in both layers slide and resize their frame: a closed box opens into the frame it stands for.
    const frames: { el: SVGGElement; rect: SVGElement; a: Box; b: Box }[] = [];
    // A frame is a rect sized by width and height, or a shaped path re-scaled from its unit path data.
    const resize = (rect: SVGElement, w: number, h: number) => {
      const unit = rect.getAttribute("data-shape");
      if (unit) rect.setAttribute("d", scalePath(unit, w, h)); else { rect.setAttribute("width", String(w)); rect.setAttribute("height", String(h)); }
    };
    for (const g of from.querySelectorAll<SVGGElement>("[data-group]")) {
      const twin = to.querySelector<SVGGElement>(`[data-group="${g.getAttribute("data-group")}"]`);
      const rect = g.querySelector<SVGElement>(".group-box");
      if (twin && rect) { frames.push({ el: g, rect, a: bbox(g), b: bbox(twin) }); g.querySelectorAll<SVGElement>("text,.expand-mark").forEach((t) => (t.style.opacity = "0")); }
      else g.style.opacity = "0";
    }
    from.querySelectorAll<SVGElement>(".edges, .legend, .callouts, .callouts-step").forEach((e) => (e.style.opacity = "0")); // what belongs to the old layout fades with it
    const start = Date.now(), dur = 350;
    let handle: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (handle) clearTimeout(handle);
      morphing = null;
      for (const m of moves) m.el.setAttribute("transform", `translate(${m.b.x} ${m.b.y})`);
      for (const f of frames) { f.el.setAttribute("transform", `translate(${f.a.x} ${f.a.y})`); resize(f.rect, f.a.width, f.a.height); }
      from.querySelectorAll<SVGElement>("[style]").forEach((e) => (e.style.opacity = ""));
      from.style.display = "none"; to.style.display = "";
      activeKey = key;
      rebuildOrder();
      if (selected) select(selected.id, selected.type);
      after();
    };
    morphing = finish;
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / dur), e = 1 - Math.pow(1 - t, 3);
      const lerp = (p: number, q: number) => p + (q - p) * e;
      for (const m of moves) m.el.setAttribute("transform", `translate(${m.b.x + m.dx * e} ${m.b.y + m.dy * e})`);
      for (const f of frames) {
        // Frames are drawn at (0,0) inside a translated group: slide the group and grow the rect.
        f.el.setAttribute("transform", `translate(${lerp(f.a.x, f.b.x)} ${lerp(f.a.y, f.b.y)})`);
        resize(f.rect, lerp(f.a.width, f.b.width), lerp(f.a.height, f.b.height));
      }
      if (t < 1) handle = setTimeout(step, 16); else finish();
    };
    if (moves.length || frames.length) step(); else finish();
  };
  /** Morph to a view's closed layer; `then` runs once it is shown. False when there is nothing to do. */
  const showView = (id: string, byPlayer = false, then?: () => void): boolean => {
    const key = layerKey(id, "");
    if (!layers.has(key) || key === activeKey) return false;
    if (!byPlayer) stop();
    openSet = []; zoomId = null; revealed = null;
    morphTo(key, () => { fit(true); apply(); if (!byPlayer) playScenario(); then?.(); });
    return true;
  };

  /* ---- the strip (R19): the author's views and scenario steps, reachable by tap; drawn by the engine, so never in a still or an image tag ---- */
  const stripRows: StripRow[] = [];
  if (opts.controls) {
    const n = viewIds.length;
    const viewAt = () => viewIds.indexOf(activeId());
    if (n > 1) stripRows.push({ name: "view", text: () => `${layers.get(layerKey(activeId(), ""))?.getAttribute("data-title") ?? activeId()} · ${viewAt() + 1} of ${n}`, can: () => true, step: (by) => { showView(viewIds[(viewAt() + by + n) % n]!); } });
    const shown = () => revealed ?? messagesOf().length;
    if (isSequence() && messagesOf().length) stripRows.push({ name: "message", text: () => `Message ${shown()} of ${messagesOf().length}`, can: (by) => shown() + by >= 0 && shown() + by <= messagesOf().length, step: (by) => setMessage(shown() + by) });
    // Every authored step of every scenario, in the order written: the taps walk this line and nothing off it.
    const stops = model.scenarios.flatMap((sc) => sc.steps.map((_, i) => ({ id: sc.id, step: i + 1 })));
    const stopAt = () => stops.findIndex((p) => p.id === session.scenario?.id && p.step === session.scenario.step);
    if (stops.length) stripRows.push({
      name: "scenario",
      text: () => { const sc = model.scenarios.find((x) => x.id === session.scenario?.id); return sc ? `${sc.label} · ${session.scenario!.step} of ${sc.steps.length}` : `Start: ${model.scenarios[0]!.label}`; },
      can: (by) => (by < 0 ? stopAt() >= 0 : stopAt() < stops.length - 1),
      step: (by) => { const to = stops[stopAt() + by]; setScenario(to?.id ?? null, to?.step); },
      leave: () => setScenario(null),
    });
  }
  if (stripRows.length) {
    const NS = "http://www.w3.org/2000/svg";
    const add = (parent: Element, tag: string, attrs: Record<string, string | number>, text?: string) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      if (text !== undefined) e.textContent = text;
      return parent.appendChild(e);
    };
    const strip = add(root, "g", { class: "strip" });
    const notes = [...model.scenarios.flatMap((sc) => sc.steps.map((st) => st.note)), ...(model.tour?.scenes.filter((sc) => layers.has(layerKey(sc.view, ""))).map((sc) => sc.note) ?? [])].filter((t): t is string => !!t);
    const clip = (text: string, chars: number) => (text.length > chars ? `${text.slice(0, Math.max(1, chars - 1))}…` : text);
    // A phone lays a bare SVG out about 980 wide and shows it small. The strip is drawn in the units the reader
    // sees, so a target is 44 on the glass whatever the layout width; measured at mount and on resize only, so a
    // pinch does not resize it under the finger.
    let unit = 1;
    const measureStrip = () => { unit = Math.max(1, 1 / (window.visualViewport?.scale ?? 1)); };
    measureStrip();
    on(window, "resize", measureStrip);
    drawStrip = () => {
      const full = screen(), width = full.width / unit;
      const wide = width >= WIDE, rowWidth = wide ? width / stripRows.length : width;
      // The note's room is the longest note's, so stepping never moves the picture.
      const perLine = Math.max(8, Math.floor((width - 32) / 7));
      const noteLines = Math.max(0, ...notes.map((t) => wrap(t, perLine).length));
      const noteHeight = noteLines ? noteLines * 18 + 10 : 0;
      const tall = noteHeight + (wide ? ROW : ROW * stripRows.length);
      stripHeight = tall * unit;
      strip.replaceChildren();
      strip.setAttribute("transform", `translate(0 ${full.height - stripHeight}) scale(${unit})`);
      add(strip, "rect", { width, height: tall, fill: "#fff" });
      add(strip, "rect", { width, height: 1, fill: "#e2e8f0" });
      const note = add(strip, "text", { class: "step-note strip-note" });
      const lines = wrap(sceneNote ?? session.note(), perLine);
      lines.forEach((line, i) => add(note, "tspan", { x: 16, y: 19 + i * 18 }, i < lines.length - 1 ? `${line} ` : line));
      stripRows.forEach((r, i) => {
        const g = add(strip, "g", { "data-strip": r.name, transform: `translate(${wide ? i * rowWidth : 0} ${noteHeight + (wide ? 0 : i * ROW)})` });
        const does = [...(r.leave ? (["leave"] as const) : []), "next", "prev"] as const;
        add(g, "text", { class: "step-note", x: 16, y: ROW / 2 }, clip(r.text(), Math.floor((rowWidth - 24 - does.length * ROW) / 7)));
        does.forEach((what, j) => {
          const live = what === "leave" ? session.scenario !== null : r.can(what === "next" ? 1 : -1);
          const b = add(g, "g", { "data-do": what, role: "button", "aria-label": SAYS[what], ...(live ? {} : { class: "off" }), transform: `translate(${rowWidth - (j + 1) * ROW} 0)` });
          add(b, "title", {}, SAYS[what]);
          add(b, "rect", { width: ROW, height: ROW, fill: "transparent" });
          add(b, "rect", { class: "key", x: 6, y: 6, width: 32, height: 32, rx: 8 });
          add(b, "path", { d: GLYPH[what] });
        });
      });
    };
    on(strip, "click", (ev) => {
      const b = (ev.target as Element).closest?.("[data-do]");
      const r = stripRows.find((x) => x.name === b?.parentElement?.getAttribute("data-strip"));
      if (!b || !r || b.classList.contains("off")) return;
      const what = b.getAttribute("data-do");
      stop();
      if (what === "leave") r.leave?.(); else r.step(what === "next" ? 1 : -1);
    });
    drawStrip();
  }

  /* ---- inside the diagram: clicks, hover, keyboard; no page code needed ---- */
  on(scene, "click", (ev) => {
    const g = (ev.target as Element).closest?.("[data-node]:not([data-ghost]),[data-group]") as SVGGElement | null;
    if (!g) return;
    stop();
    const id = g.getAttribute("data-node") ?? g.getAttribute("data-group")!;
    // A click on a closed box opens it; the whole picture stays in view. Enter or double-click zooms to the selection.
    if (g.hasAttribute("data-collapsed")) { open([...openSet, id]); return; }
    // A click on an open frame's own chrome closes that one group, the mirror of opening it. `closest` already
    // gave us the innermost box under the pointer, so a click on a child never reaches its frame (#33).
    if (g.hasAttribute("data-group") && openSet.includes(id)) { open(openSet.filter((o) => o !== id && !isInside(o, id))); return; }
    // Any other click selects, and that is all: states are the author's, or a page's own control through `setState`.
    select(id, g.hasAttribute("data-node") ? "node" : "group");
    emit();
  });
  on(scene, "dblclick", (ev) => {
    const g = (ev.target as Element).closest?.("[data-node]:not([data-ghost]),[data-group]") as SVGGElement | null;
    if (!g) return;
    ev.preventDefault();
    zoom(g.getAttribute("data-node") ?? g.getAttribute("data-group")!);
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
      layer.querySelectorAll(`[data-edge="${c.key}"],[data-flow="${c.key}"]`).forEach((e) => e.classList.add("is-hot"));
      layer.querySelector(`[data-node="${c.from === id ? c.to : c.from}"]`)?.classList.add("is-hot");
    }
  });
  on(scene, "mouseleave", () => { const layer = active(); layer.classList.remove("has-hover"); layer.querySelectorAll(".is-hot").forEach((e) => e.classList.remove("is-hot")); });
  on(document, "keydown", (ev) => {
    const k = (ev as KeyboardEvent).key;
    if ((ev as KeyboardEvent).metaKey || (ev as KeyboardEvent).ctrlKey || (ev as KeyboardEvent).altKey) return;
    if ((ev.target as Element)?.closest?.("select,button,input,textarea")) return;
    let handled = true;
    if (k === "ArrowDown" || k === "ArrowUp") {
      stop();
      const i = selected ? order.findIndex((o) => o.id === selected!.id) : -1;
      const n = order[Math.min(order.length - 1, Math.max(0, i + (k === "ArrowDown" ? 1 : -1)))];
      if (n) { select(n.id, n.type); emit(); }
    } else if (k === "Enter" && selected) zoom(selected.id);
    else if (k === "Escape") { stop(); if (!back()) { select(null); fit(true); emit(); } }
    else if (k === "s" && model.scenarios.length) { // the next scenario, from the first, none after the last
      const i = session.scenario ? model.scenarios.findIndex((sc) => sc.id === session.scenario!.id) + 1 : 0;
      setScenario(model.scenarios[i]?.id ?? null, 1);
    }
    else if (k === "[" && isSequence()) setMessage((revealed ?? messagesOf().length) - 1);
    else if (k === "]" && isSequence()) setMessage((revealed ?? messagesOf().length) + 1);
    else if (k === "[" && session.scenario) setScenario(session.scenario.id, session.scenario.step - 1);
    else if (k === "]" && session.scenario) setScenario(session.scenario.id, session.scenario.step + 1);
    else if (/^[1-9]$/.test(k)) { const id = viewIds[Number(k) - 1]; if (id) showView(id); }
    else handled = false;
    if (handled) ev.preventDefault();
  });
  on(window, "resize", () => { drawStrip(); if (!zoomId) fit(false); });

  rebuildOrder(); fit(false); apply(); play();
  return {
    views: viewIds.map((id) => ({ id, title: layers.get(layerKey(id, ""))?.getAttribute("data-title") ?? id })),
    scenarios: model.scenarios.map((s) => ({ id: s.id, label: s.label, steps: s.steps.length })),
    states: Object.values(model.states.define).map((d) => ({ name: d.name, ...(d.description !== undefined ? { description: d.description } : {}) })),
    groups: () => model.groups.filter((g) => active().querySelector(`[data-group="${g.id}"]`)).map((g) => ({ id: g.id, label: g.label, closable: collapseOf(activeId()).includes(g.id), open: openSet.includes(g.id) })),
    showView: (id) => { showView(id); },
    open, zoom,
    back: () => { stop(); return back(); },
    setScenario: (id, step) => setScenario(id, step),
    next: () => { if (isSequence()) setMessage((revealed ?? messagesOf().length) + 1); else if (session.scenario) setScenario(session.scenario.id, session.scenario.step + 1); },
    prev: () => { if (isSequence()) setMessage((revealed ?? messagesOf().length) - 1); else if (session.scenario) setScenario(session.scenario.id, session.scenario.step - 1); },
    setState, cycle, reset,
    select: (id) => { select(id, id ? typeOf(id) : "node"); emit(); },
    zoomTo: (id) => zoom(id),
    fit: () => zoom(null),
    play, stop,
    on: (_event, fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    snapshot,
    // finish the morph first: its completion may fit the camera or start a play, and both are refused or cleared after
    destroy: () => { destroyed = true; if (morphing) morphing(); stop(); if (cameraTimer) clearTimeout(cameraTimer); ac.abort(); listeners.clear(); style.remove(); root.querySelector(":scope > .strip")?.remove(); },
  };
}

// Mount when this script runs inside an Orrery SVG opened as a document.
if (typeof document !== "undefined") {
  const r = document.documentElement;
  if (r && r.getAttribute("data-orrery") === "1" && r.tagName.toLowerCase() === "svg" && !r.hasAttribute("data-mounted")) { r.setAttribute("data-mounted", "1"); mount(r as unknown as SVGSVGElement, { controls: true }); }
}
