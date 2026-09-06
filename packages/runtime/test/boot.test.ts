// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeLayoutEngine, renderDocument, validate } from "@orrery-diagrams/core";
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
    expect(rt.groups()).toEqual([{ id: "region", label: "us-east-1", closable: false, open: false }, { id: "app", label: "Application", closable: false, open: false }, { id: "data", label: "Data", closable: false, open: false }]);
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
    expect(rt.snapshot()).toMatchObject({ scenario: null, selected: null, zoom: null, open: [] });
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

  it("keyboard: arrows select in outline order, Enter zooms, f steps the state, s starts and cycles scenarios, brackets step, digits switch views, Escape resets the camera", async () => {
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
    key("Escape"); // zoomed: the first Escape zooms out
    vi.runAllTimers();
    expect(rt.snapshot()).toMatchObject({ zoom: null, selected: "fraud" });
    key("Escape"); // nothing to undo: the second clears the selection and refits
    vi.runAllTimers();
    expect(root.querySelector(".is-selected")).toBeNull();
    expect(root.querySelector(".scene")!.getAttribute("transform")).toBe(fitT);
    rt.setScenario(null);
    key("s"); // s cycles through the scenarios, from the first, at step 1
    expect(rt.snapshot().scenario).toMatchObject({ id: "orders-failover", step: 1 });
    key("]");
    key("s");
    expect(rt.snapshot().scenario).toMatchObject({ id: "stripe-outage", step: 1 });
    key("s");
    expect(rt.snapshot().scenario).toBeNull(); // past the last: none
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

describe("open and zoom", () => {
  let rt: Orrery;
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { rt?.destroy(); vi.useRealTimers(); });
  it("clicking a closed box opens it and the whole picture stays in view; Enter zooms; Escape zooms out, then closes", async () => {
    const root = await doc("drill-down");
    rt = mount(root, SIZE);
    rt.stop();
    const fitT = root.querySelector(".scene")!.getAttribute("transform");
    expect(shownLayer(root).getAttribute("data-open")).toBe("");
    expect(vis(root, '[data-node="ledger"]')).toBeNull();
    expect(rt.groups()).toEqual([{ id: "storefront", label: "Storefront", closable: false, open: false }, { id: "payments", label: "Payments", closable: true, open: false }, { id: "identity", label: "Identity", closable: true, open: false }]);
    click(vis(root, '[data-group="payments"]'));
    vi.advanceTimersByTime(100);
    expect(shownLayer(root).getAttribute("data-open")).toBe(""); // still morphing on the old layer
    vi.advanceTimersByTime(800);
    expect(shownLayer(root).getAttribute("data-open")).toBe("payments");
    expect(rt.snapshot()).toMatchObject({ open: ["payments"], zoom: null }); // open is not zoom
    expect(vis(root, '[data-node="ledger"]')).not.toBeNull();
    expect(vis(root, '[data-group="payments"]').hasAttribute("data-collapsed")).toBe(false);
    expect(vis(root, '[data-node="login"]')).toBeNull(); // identity stays closed
    expect(state(root, "payments")).toBe("on"); // opening is navigation, not a state change
    rt.select("payments");
    key("Enter");
    vi.advanceTimersByTime(400);
    expect(rt.snapshot().zoom).toBe("payments");
    expect(root.querySelector(".scene")!.getAttribute("transform")).not.toBe(fitT);
    key("Escape"); // zoom out
    vi.advanceTimersByTime(400);
    expect(rt.snapshot()).toMatchObject({ open: ["payments"], zoom: null });
    key("Escape"); // close
    vi.advanceTimersByTime(900);
    expect(shownLayer(root).getAttribute("data-open")).toBe("");
    expect(root.querySelector(".scene")!.getAttribute("transform")).toBe(fitT);
    expect(vis(root, '[data-node="ledger"]')).toBeNull();
  });
  it("open sets exactly which groups are open, in any order, and refuses a set whose closed parent is not in it", async () => {
    const root = await doc("nested-drill");
    rt = mount(root, SIZE);
    expect(rt.open(["inner"])).toBe(false); // outer is closed around it
    expect(rt.open(["app"])).toBe(false); // not a group
    expect(rt.open(["inner", "outer"])).toBe(true);
    vi.advanceTimersByTime(900);
    expect(shownLayer(root).getAttribute("data-open")).toBe("outer inner");
    expect(rt.snapshot().open).toEqual(["outer", "inner"]);
    expect(rt.groups()).toEqual([{ id: "outer", label: "Outer", closable: true, open: true }, { id: "inner", label: "Inner", closable: true, open: true }]);
    expect(rt.open(["outer"])).toBe(true);
    vi.advanceTimersByTime(900);
    expect(shownLayer(root).getAttribute("data-open")).toBe("outer");
    expect(vis(root, '[data-group="inner"]').hasAttribute("data-collapsed")).toBe(true);
    expect(rt.back()).toBe(true);
    vi.advanceTimersByTime(900);
    expect(shownLayer(root).getAttribute("data-open")).toBe("");
    expect(rt.back()).toBe(false);
  });
  it("zoom is its own action: a group can be zoomed while closed, and the zoom holds through opening if its target is still drawn", async () => {
    const root = await doc("nested-drill");
    rt = mount(root, SIZE);
    const fitT = root.querySelector(".scene")!.getAttribute("transform");
    rt.zoom("outer");
    vi.advanceTimersByTime(400);
    expect(rt.snapshot()).toMatchObject({ open: [], zoom: "outer" });
    const zoomedT = root.querySelector(".scene")!.getAttribute("transform");
    expect(zoomedT).not.toBe(fitT);
    rt.open(["outer"]);
    vi.advanceTimersByTime(900);
    expect(rt.snapshot()).toMatchObject({ open: ["outer"], zoom: "outer" });
    expect(root.querySelector(".scene")!.getAttribute("transform")).not.toBe(fitT);
    rt.zoom(null);
    vi.advanceTimersByTime(400);
    expect(rt.snapshot().zoom).toBeNull();
    expect(root.querySelector(".scene")!.getAttribute("transform")).not.toBe(zoomedT);
  });
  it("a state set while a group is open shows in every layer", async () => {
    const root = await doc("drill-down");
    rt = mount(root, SIZE);
    rt.open(["payments"]);
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
  it("plays on mount: opens and zooms per scene, applies the scenario moment, carries the caption; stops on the first interaction", async () => {
    const root = await doc("drill-down");
    rt = mount(root, SIZE);
    const fitT = root.querySelector(".scene")!.getAttribute("transform");
    expect(rt.snapshot()).toMatchObject({ playing: true, open: [], zoom: null });
    expect(vis(root, '[data-node="ledger"]')).toBeNull();
    vi.advanceTimersByTime(4000 + 800);
    expect(vis(root, '[data-node="ledger"]')).not.toBeNull();
    expect(rt.snapshot()).toMatchObject({ open: ["payments"], zoom: "payments" });
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

describe("shaped frames (R14)", () => {
  let rt: Orrery;
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { rt?.destroy(); vi.useRealTimers(); });
  it("the morph rescales a path frame to the open layer's size", async () => {
    const root = await doc("shapes");
    rt = mount(root, SIZE);
    rt.stop();
    rt.showView("closed");
    vi.advanceTimersByTime(900);
    const before = vis(root, '[data-group="own"] .group-box');
    expect(before.tagName).toBe("path");
    const closedD = before.getAttribute("d")!;
    const openD = root.querySelector<SVGGElement>('.view[data-open="own"] [data-group="own"] .group-box')!.getAttribute("d")!;
    expect(openD).not.toBe(closedD);
    rt.open(["own"]);
    vi.advanceTimersByTime(100);
    const mid = before.getAttribute("d")!;
    expect(mid).not.toBe(closedD); expect(mid).not.toBe(openD); // growing
    vi.advanceTimersByTime(800);
    expect(before.getAttribute("d")).toBe(closedD); // the old layer is restored once hidden
    expect(vis(root, '[data-group="own"] .group-box').getAttribute("d")).toBe(openD);
  });
});

describe("heading (R15)", () => {
  let rt: Orrery;
  afterEach(() => { rt?.destroy(); });
  it("keeps the camera below the heading", async () => {
    const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid/cloud.json"), "utf8")));
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const svg = await renderDocument(r.model, new FakeLayoutEngine(), { runtime: "", heading: true });
    const h = Number(svg.match(/data-heading="([\d.]+)"/)![1]);
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    const walker = parsed.createTreeWalker(parsed, 8);
    const cdata: Node[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) cdata.push(n);
    for (const n of cdata) n.parentNode!.replaceChild(parsed.createTextNode(n.textContent ?? ""), n);
    const root = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
    document.body.innerHTML = ""; document.body.appendChild(root);
    rt = mount(root, { size: { width: 1600, height: 900 } });
    rt.stop();
    const ty = Number(root.querySelector(".scene")!.getAttribute("transform")!.match(/translate\([\d.-]+ ([\d.-]+)\)/)![1]);
    expect(ty).toBeGreaterThanOrEqual(h);
    expect(root.querySelector(".heading")).not.toBeNull();
  });
});

describe("callouts (R16)", () => {
  let rt: Orrery;
  afterEach(() => { rt?.destroy(); });
  it("shows the current step's callouts and hides the rest", async () => {
    const r = validate({ components: [{ id: "a", label: "A" }, { id: "b", label: "B" }], callouts: [{ at: "a", text: "standing" }], scenarios: [{ id: "s", steps: [{ set: { failed: "a" }, callouts: [{ at: "b", text: "one" }] }, { restore: "a", callouts: [{ at: "a", text: "two" }] }] }], views: [{ id: "v" }] });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const svg = await renderDocument(r.model, new FakeLayoutEngine(), { runtime: "" });
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    const walker = parsed.createTreeWalker(parsed, 8);
    const cdata: Node[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) cdata.push(n);
    for (const n of cdata) n.parentNode!.replaceChild(parsed.createTextNode(n.textContent ?? ""), n);
    const root = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
    document.body.innerHTML = ""; document.body.appendChild(root);
    rt = mount(root, SIZE);
    rt.stop();
    const stepSets = () => [...root.querySelectorAll<SVGGElement>(".callouts-step")].filter((g) => g.style.display !== "none").map((g) => g.getAttribute("data-step"));
    expect(root.querySelector('.callouts [data-callout="a"]')).not.toBeNull(); // standing, always
    expect(stepSets()).toEqual([]);
    rt.setScenario("s", 1);
    expect(stepSets()).toEqual(["1"]);
    rt.next();
    expect(stepSets()).toEqual(["2"]);
    rt.reset();
    expect(stepSets()).toEqual([]);
  });
});

describe("sequence views (R17)", () => {
  let rt: Orrery;
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { rt?.destroy(); vi.useRealTimers(); });
  it("steps the messages of a sequence view with next, prev and the brackets; play reveals them; reset shows all", async () => {
    const root = await doc("sequence");
    rt = mount(root, SIZE);
    rt.stop();
    expect(rt.snapshot().message).toBeNull();
    rt.showView("checkout");
    vi.advanceTimersByTime(900);
    const shown = () => [...shownLayer(root).querySelectorAll<SVGGElement>(".message")].filter((g) => g.style.display !== "none").length;
    expect(shown()).toBe(6);
    expect(rt.snapshot().message).toEqual({ index: 6, count: 6 });
    rt.prev(); rt.prev();
    expect(shown()).toBe(4);
    expect(rt.snapshot().message).toEqual({ index: 4, count: 6 });
    key("]");
    expect(shown()).toBe(5);
    key("[");
    expect(shown()).toBe(4);
    rt.play();
    expect(rt.snapshot().playing).toBe(true);
    expect(shown()).toBe(0);
    vi.advanceTimersByTime(2100); // the view plays one message per second
    expect(shown()).toBe(2);
    rt.stop();
    rt.reset();
    expect(shown()).toBe(6);
    expect(rt.snapshot().message).toEqual({ index: 6, count: 6 });
    // a participant is an entity: clicking it steps its state as on the topology
    click(vis(root, '[data-node="db"]'));
    expect(state(root, "db")).toBe("degraded");
  });
});
