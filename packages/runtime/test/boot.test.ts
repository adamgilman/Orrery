// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeLayoutEngine, renderDocument, validate } from "@orrery/core";
import { mount, type Orrery, type Snapshot } from "../src/browser/index.js";

const doc = async (name: string) => {
  const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid", `${name}.json`), "utf8")));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const svg = await renderDocument(r.model, new FakeLayoutEngine(), { runtime: "" });
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const walker = parsed.createTreeWalker(parsed, 8);
  const cdata: Node[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) cdata.push(n);
  for (const n of cdata) n.parentNode!.replaceChild(parsed.createTextNode(n.textContent ?? ""), n);
  const root = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
  document.body.innerHTML = "";
  document.body.appendChild(root);
  return root;
};
/** The layer on show. The runtime hides layers through `style.display`, which jsdom serialises with a space, so read the property, not the attribute. */
const shownLayer = (root: Element) => [...root.querySelectorAll<SVGGElement>(".view")].find((g) => g.style.display !== "none")!;
const vis = (root: Element, sel: string) => shownLayer(root).querySelector(sel)!;
const state = (root: Element, id: string) => vis(root, `[data-node="${id}"],[data-group="${id}"]`).getAttribute("data-state");
const flowLoad = (root: Element, key: string) => vis(root, `[data-flow="${key}"]`).getAttribute("data-load");
const click = (el: Element, init: MouseEventInit = {}) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));
const key = (k: string) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
const SIZE = { size: { width: 1600, height: 900 } };

describe("mount: the engine's interface", () => {
  let rt: Orrery;
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { rt?.destroy(); vi.useRealTimers(); });

  it("describes what the model offers, adds no user interface, and fills the window", async () => {
    const root = await doc("grouped");
    rt = mount(root, SIZE);
    expect(rt.views).toEqual([{ id: "overview", title: "Grouped three tier" }, { id: "data-tier", title: "Data tier" }]);
    expect(rt.states.map((s) => s.name)).toEqual(["on", "degraded", "failed", "off"]);
    expect(rt.states[2]).toEqual({ name: "failed", description: "Broken" });
    expect(rt.scenarios).toEqual([]);
    expect(rt.groups()).toEqual([{ id: "region", label: "us-east-1", closed: false }, { id: "app", label: "Application", closed: false }, { id: "data", label: "Data", closed: false }]);
    expect(root.querySelector("foreignObject")).toBeNull();
    expect(root.getAttribute("width")).toBe("100%");
  });

  it("emits a snapshot after every change: states as drawn, the scenario position, selection, and what is open", async () => {
    const root = await doc("alternatives");
    rt = mount(root, SIZE);
    const seen: Snapshot[] = [];
    const off = rt.on("change", (s) => seen.push(s));
    rt.setState("orders", "failed");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.states["orders"]).toEqual({ state: "failed" });
    expect(seen[0]!.states["api"]).toEqual({ state: "on" });
    expect(seen[0]!.scenario).toBeNull();
    expect(seen[0]!.view).toBe("overview");
    rt.setScenario("orders-failover", 1);
    const s = rt.snapshot();
    expect(s.scenario).toEqual({ id: "orders-failover", step: 1, steps: 4, note: "Primary goes down; reads move to the replica, API runs reduced" });
    expect(s.states["api"]).toEqual({ state: "degraded", reason: "reads from the replica" });
    rt.select("api");
    expect(rt.snapshot().selected).toBe("api");
    expect(vis(root, '[data-node="api"]').classList.contains("is-selected")).toBe(true);
    off();
    rt.setState("orders", "on");
    expect(seen.length).toBe(3); // unsubscribed: setScenario and select were the last two
  });

  it("steps a scenario with next and prev, clamped, on top of the base model", async () => {
    const root = await doc("alternatives");
    rt = mount(root, SIZE);
    rt.setScenario("orders-failover");
    expect(state(root, "orders")).toBe("failed");
    expect(rt.snapshot().scenario!.step).toBe(1);
    rt.next();
    expect(state(root, "fraud")).toBe("failed");
    rt.next();
    expect(state(root, "api")).toBe("failed");
    rt.next();
    expect(state(root, "orders")).toBe("on");
    rt.next();
    expect(rt.snapshot().scenario!.step).toBe(4); // clamped
    rt.prev();
    expect(state(root, "api")).toBe("failed");
    rt.setScenario(null);
    expect(state(root, "orders")).toBe("on");
    expect(rt.snapshot().scenario).toBeNull();
  });

  it("sets any of the author's states; a step's reason shows as a tooltip; a group's state is its own", async () => {
    const root = await doc("own-vocabulary");
    rt = mount(root, SIZE);
    rt.setState("seq-1", "outage");
    expect(state(root, "seq-1")).toBe("outage");
    expect(state(root, "match-a")).toBe("healthy");
    rt.setScenario("cell-drain");
    expect(state(root, "edge")).toBe("impaired");
    expect(vis(root, '[data-node="edge"] title').textContent).toBe("running on cell B alone");
    rt.setScenario(null);
    rt.setState("cell-a", "drained");
    expect(state(root, "cell-a")).toBe("drained");
    expect(state(root, "match-a")).toBe("healthy");
    expect(flowLoad(root, "edge->cell-a")).toBe("0"); // drained stops flow into the group
  });

  it("switches views with a morph and refits the camera; states carry across views", async () => {
    const root = await doc("grouped");
    rt = mount(root, SIZE);
    const before = root.querySelector(".scene")!.getAttribute("transform");
    rt.showView("data-tier");
    vi.runAllTimers();
    expect([...root.querySelectorAll(".view")].map((l) => (l as HTMLElement).style.display)).toEqual(["none", ""]);
    expect(root.querySelector(".scene")!.getAttribute("transform")).not.toBe(before);
    expect(rt.snapshot().view).toBe("data-tier");
    rt.setState("db", "degraded");
    rt.showView("overview");
    vi.runAllTimers();
    expect(state(root, "db")).toBe("degraded");
    expect(state(root, "api")).toBe("on");
  });

  it("a second view switch during a morph leaves exactly one view visible", async () => {
    const root = await doc("own-vocabulary");
    rt = mount(root, SIZE);
    rt.showView("eu-only");
    rt.showView("matching");
    vi.runAllTimers();
    expect([...root.querySelectorAll(".view")].map((l) => `${l.getAttribute("data-view")}:${(l as HTMLElement).style.display || "shown"}`)).toEqual(["overview:none", "eu-only:none", "matching:shown"]);
  });

  it("zoomTo, fit and reset move the camera; reset clears every state and scenario", async () => {
    const root = await doc("alternatives");
    rt = mount(root, SIZE);
    const fitT = root.querySelector(".scene")!.getAttribute("transform");
    rt.zoomTo("api");
    vi.runAllTimers();
    expect(root.querySelector(".scene")!.getAttribute("transform")).not.toBe(fitT);
    rt.fit();
    vi.runAllTimers();
    expect(root.querySelector(".scene")!.getAttribute("transform")).toBe(fitT);
    rt.setState("orders", "failed");
    rt.setScenario("orders-failover", 2);
    rt.reset();
    vi.runAllTimers();
    expect(state(root, "orders")).toBe("on");
    expect(rt.snapshot()).toMatchObject({ scenario: null, selected: null, focus: null, open: [] });
  });

  it("destroy stops listening and leaves the diagram as it is", async () => {
    const root = await doc("alternatives");
    rt = mount(root, SIZE);
    rt.setState("orders", "degraded");
    rt.destroy();
    click(vis(root, '[data-node="orders"]'));
    expect(state(root, "orders")).toBe("degraded");
  });
});

describe("inside the diagram: clicks and keyboard need no page code", () => {
  let rt: Orrery;
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { rt?.destroy(); vi.useRealTimers(); });

  it("click steps an entity through the author's states, shift+click steps back; nothing else changes", async () => {
    const root = await doc("alternatives");
    rt = mount(root, SIZE);
    const orders = vis(root, '[data-node="orders"]');
    click(orders);
    expect(state(root, "orders")).toBe("degraded");
    click(orders);
    expect(state(root, "orders")).toBe("failed");
    expect(state(root, "api")).toBe("on"); // the reader set one thing; the diagram infers nothing
    expect(state(root, "web")).toBe("on");
    expect(flowLoad(root, "api->orders")).toBe("0"); // failed stops flow: a drawing rule
    expect(flowLoad(root, "api->replica")).toBe("0"); // loads never move on their own
    expect(vis(root, '[data-node="api"] title')).toBeNull();
    expect(orders.classList.contains("st-failed")).toBe(true);
    expect(orders.getAttribute("data-pulse")).toBe("1");
    expect(rt.snapshot().selected).toBe("orders");
    click(orders);
    expect(state(root, "orders")).toBe("off");
    click(orders);
    expect(state(root, "orders")).toBe("on");
    click(orders, { shiftKey: true });
    expect(state(root, "orders")).toBe("off");
  });

  it("a click steps on from the state a scenario set, and modifier keys are ignored", async () => {
    const root = await doc("alternatives");
    rt = mount(root, SIZE);
    rt.setScenario("orders-failover");
    expect(state(root, "orders")).toBe("failed");
    click(vis(root, '[data-node="orders"]'));
    expect(state(root, "orders")).toBe("off");
    click(vis(root, '[data-node="orders"]'));
    expect(state(root, "orders")).toBe("on");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "]", metaKey: true, bubbles: true }));
    expect(rt.snapshot().scenario!.step).toBe(1);
  });

  it("keyboard: arrows select in outline order, Enter zooms, f steps the state, brackets step the scenario, digits switch views, Escape resets the camera", async () => {
    const root = await doc("alternatives");
    rt = mount(root, SIZE);
    const fitT = root.querySelector(".scene")!.getAttribute("transform");
    key("ArrowDown"); // ungrouped components come first: web, then api
    expect(rt.snapshot().selected).toBe("web");
    key("ArrowDown");
    expect(root.querySelector(".is-selected")!.getAttribute("data-node")).toBe("api");
    key("Enter");
    vi.runAllTimers();
    expect(root.querySelector(".scene")!.getAttribute("transform")).not.toBe(fitT);
    key("ArrowDown");
    expect(rt.snapshot().selected).toBe("fraud");
    key("f");
    expect(state(root, "fraud")).toBe("degraded");
    expect(state(root, "api")).toBe("on");
    rt.setScenario("orders-failover", 1);
    key("]");
    expect(rt.snapshot().scenario!.step).toBe(2);
    key("[");
    expect(rt.snapshot().scenario!.step).toBe(1);
    key("Escape");
    vi.runAllTimers();
    expect(root.querySelector(".is-selected")).toBeNull();
    expect(root.querySelector(".scene")!.getAttribute("transform")).toBe(fitT);
    key("2");
    vi.advanceTimersByTime(500); // the morph; this view then plays its scenario on a loop
    expect(rt.snapshot()).toMatchObject({ view: "failover-loop", playing: true });
  });
});

describe("playing", () => {
  let rt: Orrery;
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { rt?.destroy(); vi.useRealTimers(); });
  it("plays the view's scenario on its timer, loops, reports playing, and stops on the first interaction", async () => {
    const root = await doc("alternatives");
    rt = mount(root, SIZE);
    rt.showView("failover-loop");
    vi.advanceTimersByTime(400); // finish the morph
    expect(shownLayer(root).querySelectorAll(".step")).toHaveLength(1); // extra step layers removed, CSS cycle gone
    expect(rt.snapshot()).toMatchObject({ playing: true, scenario: null });
    vi.advanceTimersByTime(2000);
    expect(rt.snapshot().scenario).toMatchObject({ id: "orders-failover", step: 1 });
    expect(state(root, "orders")).toBe("failed");
    vi.advanceTimersByTime(6000);
    expect(rt.snapshot().scenario!.step).toBe(4);
    vi.advanceTimersByTime(2000);
    expect(rt.snapshot().scenario).toBeNull(); // back to base, then loops
    vi.advanceTimersByTime(2000);
    expect(rt.snapshot().scenario!.step).toBe(1);
    click(vis(root, '[data-node="fraud"]'));
    expect(rt.snapshot().playing).toBe(false);
    vi.advanceTimersByTime(10000);
    expect(rt.snapshot().scenario!.step).toBe(1); // timer stopped
    rt.play();
    expect(rt.snapshot().playing).toBe(true);
    rt.stop();
    expect(rt.snapshot().playing).toBe(false);
  });
});

describe("drill-down", () => {
  let rt: Orrery;
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { rt?.destroy(); vi.useRealTimers(); });
  it("clicking a closed group opens it: a morph to the layer with that group open, then the camera closes on it; Escape returns", async () => {
    const root = await doc("drill-down");
    rt = mount(root, SIZE);
    rt.stop();
    const fitT = root.querySelector(".scene")!.getAttribute("transform");
    expect(shownLayer(root).getAttribute("data-open")).toBe("");
    expect(vis(root, '[data-node="ledger"]')).toBeNull();
    expect(rt.groups()).toEqual([{ id: "storefront", label: "Storefront", closed: false }, { id: "payments", label: "Payments", closed: true }, { id: "identity", label: "Identity", closed: true }]);
    click(vis(root, '[data-group="payments"]'));
    vi.advanceTimersByTime(100);
    expect(shownLayer(root).getAttribute("data-open")).toBe(""); // still morphing on the old layer
    vi.advanceTimersByTime(800);
    expect(shownLayer(root).getAttribute("data-open")).toBe("payments");
    expect(rt.snapshot()).toMatchObject({ open: ["payments"], focus: "payments" });
    expect(vis(root, '[data-node="ledger"]')).not.toBeNull();
    expect(vis(root, '[data-group="payments"]').hasAttribute("data-collapsed")).toBe(false);
    expect(vis(root, '[data-node="login"]')).toBeNull(); // identity stays closed
    expect(root.querySelector(".scene")!.getAttribute("transform")).not.toBe(fitT);
    expect(state(root, "payments")).toBe("on"); // focusing is navigation, not a state change
    key("Escape");
    vi.advanceTimersByTime(900);
    expect(shownLayer(root).getAttribute("data-open")).toBe("");
    expect(root.querySelector(".scene")!.getAttribute("transform")).toBe(fitT);
    expect(vis(root, '[data-node="ledger"]')).toBeNull();
  });
  it("focus and back from the interface: an inner closed group opens inside an open one, one level back at a time", async () => {
    const root = await doc("nested-drill");
    rt = mount(root, SIZE);
    rt.focus("outer");
    vi.advanceTimersByTime(900);
    expect(shownLayer(root).getAttribute("data-open")).toBe("outer");
    expect(rt.groups()).toEqual([{ id: "outer", label: "Outer", closed: false }, { id: "inner", label: "Inner", closed: true }]);
    rt.focus("inner");
    vi.advanceTimersByTime(900);
    expect(shownLayer(root).getAttribute("data-open")).toBe("outer inner");
    expect(rt.snapshot().open).toEqual(["outer", "inner"]);
    expect(rt.back()).toBe(true);
    vi.advanceTimersByTime(900);
    expect(shownLayer(root).getAttribute("data-open")).toBe("outer");
    expect(rt.back()).toBe(true);
    vi.advanceTimersByTime(900);
    expect(shownLayer(root).getAttribute("data-open")).toBe("");
    expect(rt.back()).toBe(false);
  });
  it("a state set while drilled in shows in every layer", async () => {
    const root = await doc("drill-down");
    rt = mount(root, SIZE);
    rt.focus("payments");
    vi.advanceTimersByTime(900);
    click(vis(root, '[data-node="ledger"]'));
    expect(state(root, "ledger")).toBe("degraded");
    rt.back();
    vi.advanceTimersByTime(900);
    expect(root.querySelector('.view[data-open="payments"] [data-node="ledger"]')!.getAttribute("data-state")).toBe("degraded");
  });
});

describe("the tour", () => {
  let rt: Orrery;
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { rt?.destroy(); vi.useRealTimers(); });
  it("plays on mount: opens the focus, applies the scenario moment, carries the caption; stops on the first interaction", async () => {
    const root = await doc("drill-down");
    rt = mount(root, SIZE);
    const fitT = root.querySelector(".scene")!.getAttribute("transform");
    expect(rt.snapshot()).toMatchObject({ playing: true, focus: null });
    expect(vis(root, '[data-node="ledger"]')).toBeNull();
    vi.advanceTimersByTime(4000 + 800);
    expect(vis(root, '[data-node="ledger"]')).not.toBeNull();
    expect(root.querySelector(".scene")!.getAttribute("transform")).not.toBe(fitT);
    vi.advanceTimersByTime(4000);
    expect(state(root, "ledger")).toBe("failed");
    expect(rt.snapshot().scenario!.note).toMatch(/The ledger fails/);
    vi.advanceTimersByTime(4000 + 800);
    expect(vis(root, '[data-node="ledger"]')).toBeNull();
    expect(root.querySelector(".scene")!.getAttribute("transform")).toBe(fitT);
    expect(state(root, "payments")).toBe("degraded");
    vi.advanceTimersByTime(4000);
    expect(state(root, "payments")).toBe("on"); // looped to scene one: the scenario is gone
    key("ArrowDown");
    expect(rt.snapshot().playing).toBe(false);
    vi.advanceTimersByTime(30000);
    expect(state(root, "payments")).toBe("on");
    expect(vis(root, '[data-node="ledger"]')).toBeNull();
  });
});
