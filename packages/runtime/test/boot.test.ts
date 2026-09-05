// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeLayoutEngine, renderDocument, validate } from "@orrery/core";
import { boot, type Runtime } from "../src/browser/index.js";

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
const change = (el: HTMLSelectElement, v: string) => { el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); };

describe("runtime boot", () => {
  let rt: Runtime;
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { rt?.destroy(); vi.useRealTimers(); });

  it("builds a panel with title, views, scenarios, state buttons and an outline of the active view", async () => {
    const root = await doc("grouped");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    const panel = root.querySelector(".orrery-panel")!;
    expect(panel.querySelector(".orrery-title")!.textContent).toBe("Grouped three tier");
    expect([...panel.querySelectorAll(".orrery-views option")].map((o) => o.textContent)).toEqual(["Grouped three tier", "Data tier"]);
    expect([...panel.querySelectorAll(".orrery-states button")].map((b) => b.textContent)).toEqual(["on", "degraded", "failed", "off"]);
    expect([...panel.querySelectorAll(".orrery-outline li")].map((li) => li.getAttribute("data-id"))).toEqual(["web", "region", "app", "api", "data", "db", "replica"]);
    expect(root.getAttribute("width")).toBe("100%");
  });

  it("click steps an entity through the author's states, shift+click steps back; nothing else changes", async () => {
    const root = await doc("alternatives");
    rt = boot(root, { size: { width: 1600, height: 900 } });
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
    click(orders);
    expect(state(root, "orders")).toBe("off");
    click(orders);
    expect(state(root, "orders")).toBe("on");
    click(orders, { shiftKey: true });
    expect(state(root, "orders")).toBe("off");
  });

  it("the state bar sets any of the author's states; a scenario step's reason shows as a tooltip", async () => {
    const root = await doc("own-vocabulary");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    const seq = vis(root, '[data-node="seq-1"]');
    click(seq);
    expect(state(root, "seq-1")).toBe("impaired");
    click(seq);
    expect(state(root, "seq-1")).toBe("brownout");
    click(root.querySelector('.orrery-states button[data-state="outage"]')!);
    expect(state(root, "seq-1")).toBe("outage");
    expect(state(root, "match-a")).toBe("healthy");
    click(root.querySelector('.orrery-states button[data-state="healthy"]')!);
    expect(state(root, "seq-1")).toBe("healthy");
    change(root.querySelector<HTMLSelectElement>(".orrery-scenarios")!, "cell-drain");
    expect(state(root, "edge")).toBe("impaired");
    expect(vis(root, '[data-node="edge"] title').textContent).toBe("running on cell B alone");
  });

  it("a group can be clicked; its state is its own and says nothing about its members", async () => {
    const root = await doc("own-vocabulary");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    click(vis(root, '[data-group="cell-a"]'));
    expect(state(root, "cell-a")).toBe("impaired");
    expect(state(root, "match-a")).toBe("healthy");
    click(root.querySelector('.orrery-states button[data-state="drained"]')!);
    expect(state(root, "cell-a")).toBe("drained");
    expect(state(root, "match-a")).toBe("healthy");
    expect(flowLoad(root, "edge->cell-a")).toBe("0"); // drained stops flow into the group
  });

  it("plays a scenario step by step with its note, on top of the base model", async () => {
    const root = await doc("alternatives");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    change(root.querySelector<HTMLSelectElement>(".orrery-scenarios")!, "orders-failover");
    expect(state(root, "orders")).toBe("failed");
    expect(root.querySelector(".orrery-note")!.textContent).toMatch(/Primary goes down/);
    expect(root.querySelector(".orrery-step")!.textContent).toBe("1 / 4");
    click(root.querySelector(".orrery-next")!);
    expect(state(root, "fraud")).toBe("failed");
    click(root.querySelector(".orrery-next")!);
    expect(state(root, "api")).toBe("failed");
    click(root.querySelector(".orrery-next")!);
    expect(state(root, "orders")).toBe("on");
    click(root.querySelector(".orrery-prev")!);
    expect(state(root, "api")).toBe("failed");
    change(root.querySelector<HTMLSelectElement>(".orrery-scenarios")!, "");
    expect(state(root, "orders")).toBe("on");
  });

  it("switches views with a morph and refits the camera; overrides carry across views", async () => {
    const root = await doc("grouped");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    const before = root.querySelector(".scene")!.getAttribute("transform");
    rt.showView("data-tier");
    vi.runAllTimers();
    expect([...root.querySelectorAll(".view")].map((l) => (l as HTMLElement).style.display)).toEqual(["none", ""]);
    expect(root.querySelector(".scene")!.getAttribute("transform")).not.toBe(before);
    expect([...root.querySelectorAll(".orrery-outline li")].map((li) => li.getAttribute("data-id"))).toEqual(["data", "db", "replica"]); // ghosts are not listed
    click(vis(root, '[data-node="db"]'));
    rt.showView("overview");
    vi.runAllTimers();
    expect(state(root, "db")).toBe("degraded");
    expect(state(root, "api")).toBe("on");
  });

  it("outline click selects and zooms; keyboard navigates, sets and resets", async () => {
    const root = await doc("alternatives");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    const fit = root.querySelector(".scene")!.getAttribute("transform");
    click(root.querySelector('.orrery-outline li[data-id="api"]')!);
    vi.runAllTimers();
    expect(vis(root, '[data-node="api"]').classList.contains("is-selected")).toBe(true);
    expect(root.querySelector(".scene")!.getAttribute("transform")).not.toBe(fit);
    key("ArrowDown"); // ungrouped components come before groups in the outline
    expect(root.querySelector(".is-selected")!.getAttribute("data-node")).toBe("fraud");
    key("f");
    expect(state(root, "fraud")).toBe("degraded");
    expect(state(root, "api")).toBe("on");
    key("f");
    expect(state(root, "fraud")).toBe("failed");
    key("Escape");
    vi.runAllTimers();
    expect(root.querySelector(".is-selected")).toBeNull();
    expect(root.querySelector(".scene")!.getAttribute("transform")).toBe(fit);
  });

  it("a click undoes a state the scenario set, and modifier keys are ignored", async () => {
    const root = await doc("alternatives");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    change(root.querySelector<HTMLSelectElement>(".orrery-scenarios")!, "orders-failover");
    expect(state(root, "orders")).toBe("failed");
    click(vis(root, '[data-node="orders"]')); // steps on from the state the scenario set
    expect(state(root, "orders")).toBe("off");
    click(vis(root, '[data-node="orders"]'));
    expect(state(root, "orders")).toBe("on");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "]", metaKey: true, bubbles: true }));
    expect(root.querySelector(".orrery-step")!.textContent).toBe("1 / 4");
  });

  it("a second view switch during a morph leaves exactly one view visible", async () => {
    const root = await doc("own-vocabulary");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    rt.showView("eu-only");
    rt.showView("matching");
    vi.runAllTimers();
    expect([...root.querySelectorAll(".view")].map((l) => `${l.getAttribute("data-view")}:${(l as HTMLElement).style.display || "shown"}`)).toEqual(["overview:none", "eu-only:none", "matching:shown"]);
  });

  it("destroy removes the panel and stops listening", async () => {
    const root = await doc("alternatives");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    rt.destroy();
    expect(root.querySelector(".orrery-panel")).toBeNull();
    click(vis(root, '[data-node="orders"]'));
    expect(state(root, "orders")).toBe("on");
  });

  it("reset clears every override and scenario", async () => {
    const root = await doc("alternatives");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    click(vis(root, '[data-node="orders"]'));
    click(root.querySelector(".orrery-reset")!);
    expect(state(root, "orders")).toBe("on");
  });
});

describe("runtime autoplay", () => {
  let rt: Runtime;
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { rt?.destroy(); vi.useRealTimers(); });
  it("plays the view's scenario on its timer, loops, and stops on the first interaction", async () => {
    const root = await doc("alternatives");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    rt.showView("failover-loop");
    vi.advanceTimersByTime(400); // finish the morph
    expect(shownLayer(root).querySelectorAll(".step")).toHaveLength(1); // extra step layers removed, CSS cycle gone
    expect(root.querySelector(".orrery-step")!.textContent).toBe("");
    vi.advanceTimersByTime(2000);
    expect(root.querySelector(".orrery-step")!.textContent).toBe("1 / 4");
    expect(state(root, "orders")).toBe("failed");
    vi.advanceTimersByTime(6000);
    expect(root.querySelector(".orrery-step")!.textContent).toBe("4 / 4");
    vi.advanceTimersByTime(2000);
    expect(root.querySelector(".orrery-step")!.textContent).toBe(""); // back to base, then loops
    vi.advanceTimersByTime(2000);
    expect(root.querySelector(".orrery-step")!.textContent).toBe("1 / 4");
    click(vis(root, '[data-node="fraud"]'));
    vi.advanceTimersByTime(10000);
    expect(root.querySelector(".orrery-step")!.textContent).toBe("1 / 4"); // timer stopped
  });
});

describe("runtime drill-down", () => {
  let rt: Runtime;
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { rt?.destroy(); vi.useRealTimers(); });
  it("clicking a closed group opens it: a morph to the layer with that group open, then the camera closes on it; Escape returns", async () => {
    const root = await doc("drill-down");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    const fitT = root.querySelector(".scene")!.getAttribute("transform");
    expect(shownLayer(root).getAttribute("data-open")).toBe("");
    expect(vis(root, '[data-node="ledger"]')).toBeNull();
    expect(vis(root, '[data-group="payments"]').hasAttribute("data-collapsed")).toBe(true);
    click(vis(root, '[data-group="payments"]'));
    vi.advanceTimersByTime(100);
    expect(shownLayer(root).getAttribute("data-open")).toBe(""); // still morphing on the old layer
    vi.advanceTimersByTime(800);
    expect(shownLayer(root).getAttribute("data-open")).toBe("payments");
    expect(vis(root, '[data-node="ledger"]')).not.toBeNull();
    expect(vis(root, '[data-group="payments"]').hasAttribute("data-collapsed")).toBe(false);
    expect(vis(root, '[data-node="login"]')).toBeNull(); // identity stays closed
    expect(root.querySelector(".scene")!.getAttribute("transform")).not.toBe(fitT);
    expect(state(root, "payments")).toBe("on"); // focusing is navigation, not a state change
    expect([...root.querySelectorAll(".orrery-outline li")].map((li) => li.getAttribute("data-id"))).toContain("ledger");
    key("Escape");
    vi.advanceTimersByTime(900);
    expect(shownLayer(root).getAttribute("data-open")).toBe("");
    expect(root.querySelector(".scene")!.getAttribute("transform")).toBe(fitT);
    expect(vis(root, '[data-node="ledger"]')).toBeNull();
  });
  it("opens a closed group inside an open one; Escape steps back out one level at a time", async () => {
    const root = await doc("nested-drill");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    click(vis(root, '[data-group="outer"]'));
    vi.advanceTimersByTime(900);
    expect(shownLayer(root).getAttribute("data-open")).toBe("outer");
    expect(vis(root, '[data-node="y"]')).not.toBeNull();
    expect(vis(root, '[data-group="inner"]').hasAttribute("data-collapsed")).toBe(true);
    expect(vis(root, '[data-node="x"]')).toBeNull();
    click(vis(root, '[data-group="inner"]'));
    vi.advanceTimersByTime(900);
    expect(shownLayer(root).getAttribute("data-open")).toBe("outer inner");
    expect(vis(root, '[data-node="x"]')).not.toBeNull();
    expect(vis(root, '[data-node="y"]')).not.toBeNull();
    key("Escape");
    vi.advanceTimersByTime(900);
    expect(shownLayer(root).getAttribute("data-open")).toBe("outer");
    key("Escape");
    vi.advanceTimersByTime(900);
    expect(shownLayer(root).getAttribute("data-open")).toBe("");
  });
  it("a state set while drilled in shows in every layer", async () => {
    const root = await doc("drill-down");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    click(vis(root, '[data-group="payments"]'));
    vi.advanceTimersByTime(900);
    click(vis(root, '[data-node="ledger"]'));
    expect(state(root, "ledger")).toBe("degraded");
    key("Escape");
    vi.advanceTimersByTime(900);
    expect(root.querySelector('.view[data-open="payments"] [data-node="ledger"]')!.getAttribute("data-state")).toBe("degraded");
  });
});

describe("runtime tour", () => {
  let rt: Runtime;
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { rt?.destroy(); vi.useRealTimers(); });
  it("plays the model's scenes: camera focus, scenario moments, captions; stops on the first interaction", async () => {
    const root = await doc("drill-down");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    const fitT = root.querySelector(".scene")!.getAttribute("transform");
    expect(root.querySelector(".orrery-note")!.textContent).toBe("The platform. Payments and Identity are closed.");
    expect(vis(root, '[data-node="ledger"]')).toBeNull();
    vi.advanceTimersByTime(4000 + 800);
    expect(vis(root, '[data-node="ledger"]')).not.toBeNull();
    expect(root.querySelector(".scene")!.getAttribute("transform")).not.toBe(fitT);
    vi.advanceTimersByTime(4000);
    expect(state(root, "ledger")).toBe("failed");
    expect(root.querySelector(".orrery-note")!.textContent).toMatch(/The ledger fails/);
    vi.advanceTimersByTime(4000 + 800);
    expect(vis(root, '[data-node="ledger"]')).toBeNull();
    expect(root.querySelector(".scene")!.getAttribute("transform")).toBe(fitT);
    expect(state(root, "payments")).toBe("degraded");
    vi.advanceTimersByTime(4000);
    expect(state(root, "payments")).toBe("on"); // looped to scene one: the scenario is gone
    key("ArrowDown");
    vi.advanceTimersByTime(30000);
    expect(state(root, "payments")).toBe("on");
    expect(vis(root, '[data-node="ledger"]')).toBeNull();
  });
});
