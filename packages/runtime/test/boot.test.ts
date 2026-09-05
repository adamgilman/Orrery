// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
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
const vis = (root: Element, sel: string) => root.querySelector(`.view:not([style*="display:none"]) ${sel}`)!;
const state = (root: Element, id: string) => vis(root, `[data-node="${id}"],[data-group="${id}"]`).getAttribute("data-state");
const flowLoad = (root: Element, key: string) => vis(root, `[data-flow="${key}"]`).getAttribute("data-load");
const click = (el: Element, init: MouseEventInit = {}) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));
const key = (k: string) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
const change = (el: HTMLSelectElement, v: string) => { el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); };

describe("runtime boot", () => {
  let rt: Runtime;
  beforeEach(() => { vi.useFakeTimers(); });

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

  it("click sets the document's unmet state and propagates; click again restores", async () => {
    const root = await doc("alternatives");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    const orders = vis(root, '[data-node="orders"]');
    click(orders);
    expect(state(root, "orders")).toBe("failed");
    expect(state(root, "api")).toBe("degraded");
    expect(state(root, "web")).toBe("degraded");
    expect(flowLoad(root, "api->orders")).toBe("0");
    expect(flowLoad(root, "api->replica")).toBe("0.6");
    expect(vis(root, '[data-node="api"] title').textContent).toBe("Orders DB unavailable, using Orders replica");
    expect(orders.classList.contains("st-failed")).toBe(true);
    expect(orders.getAttribute("data-pulse")).toBe("1");
    click(orders);
    expect(state(root, "orders")).toBe("on");
    expect(state(root, "api")).toBe("on");
    expect(flowLoad(root, "api->replica")).toBe("0");
  });

  it("shift+click cycles through the author's states; the state bar sets any state", async () => {
    const root = await doc("own-vocabulary");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    const seq = vis(root, '[data-node="seq-1"]');
    click(seq, { shiftKey: true });
    expect(state(root, "seq-1")).toBe("impaired");
    click(seq, { shiftKey: true });
    expect(state(root, "seq-1")).toBe("brownout");
    click(root.querySelector('.orrery-states button[data-state="outage"]')!);
    expect(state(root, "seq-1")).toBe("outage");
    expect(state(root, "match-a")).toBe("impaired");
    click(root.querySelector('.orrery-states button[data-state="healthy"]')!);
    expect(state(root, "seq-1")).toBe("healthy");
  });

  it("a group can be clicked; a cascading state reaches its members", async () => {
    const root = await doc("own-vocabulary");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    click(vis(root, '[data-group="cell-a"]'));
    expect(state(root, "cell-a")).toBe("outage");
    expect(state(root, "match-a")).toBe("healthy"); // outage does not cascade
    click(root.querySelector('.orrery-states button[data-state="drained"]')!);
    expect(state(root, "match-a")).toBe("drained");
    expect(state(root, "edge")).toBe("impaired");
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
    expect(state(root, "db")).toBe("failed");
    expect(state(root, "api")).toBe("degraded");
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
    expect(state(root, "fraud")).toBe("failed");
    expect(state(root, "api")).toBe("degraded");
    key("f");
    expect(state(root, "fraud")).toBe("on");
    key("Escape");
    vi.runAllTimers();
    expect(root.querySelector(".is-selected")).toBeNull();
    expect(root.querySelector(".scene")!.getAttribute("transform")).toBe(fit);
  });

  it("reset clears every override and scenario", async () => {
    const root = await doc("alternatives");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    click(vis(root, '[data-node="orders"]'));
    click(root.querySelector(".orrery-reset")!);
    expect(state(root, "orders")).toBe("on");
  });
});
