// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeLayoutEngine, renderDocument, validate } from "@orrery/core";
import { boot, type Runtime } from "../src/browser/index.js";

const doc = async (name: string) => {
  const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid", `${name}.json`), "utf8")));
  if (!r.ok) throw new Error(name);
  const svg = await renderDocument(r.diagram, new FakeLayoutEngine(), { runtime: "" });
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  // HTML documents cannot hold CDATA sections; turn them into plain text before adopting the tree.
  const walker = parsed.createTreeWalker(parsed, 8 /* CDATA_SECTION_NODE */);
  const cdata: Node[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) cdata.push(n);
  for (const n of cdata) n.parentNode!.replaceChild(parsed.createTextNode(n.textContent ?? ""), n);
  // adopt into the test document so querySelector/events behave like a real page
  const root = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
  document.body.innerHTML = "";
  document.body.appendChild(root);
  return root;
};
const state = (root: Element, id: string) => root.querySelector(`.view:not([style*="display:none"]) [data-node="${id}"]`)!.getAttribute("data-state");
const flowLoad = (root: Element, id: string) => root.querySelector(`.view:not([style*="display:none"]) [data-flow="${id}"]`)!.getAttribute("data-load");
const click = (el: Element, init: MouseEventInit = {}) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));
const key = (k: string) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

describe("runtime boot", () => {
  let rt: Runtime;
  beforeEach(() => { vi.useFakeTimers(); });

  it("builds a panel with title, views, scenarios and an outline of the active view", async () => {
    const root = await doc("grouped");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    const panel = root.querySelector(".orrery-panel")!;
    expect(panel).toBeTruthy();
    expect(panel.querySelector(".orrery-title")!.textContent).toBe("Grouped three tier");
    expect([...panel.querySelectorAll(".orrery-views option")].map((o) => o.textContent)).toEqual(["Grouped three tier", "Data tier"]);
    const outline = [...panel.querySelectorAll(".orrery-outline li")].map((li) => li.getAttribute("data-id"));
    expect(outline).toEqual(["web", "region", "app", "api", "data", "db", "replica"]);
    expect(root.getAttribute("width")).toBe("100%");
    expect(root.querySelector(".scene")!.getAttribute("transform")).toMatch(/^translate\(.+\) scale\(.+\)$/);
  });

  it("click toggles a node failed and propagates through the model; click again restores", async () => {
    const root = await doc("failover");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    const db = root.querySelector('[data-node="db"]')!;
    click(db);
    expect(state(root, "db")).toBe("failed");
    expect(state(root, "api")).toBe("degraded");
    expect(flowLoad(root, "api->db")).toBe("0");
    expect(flowLoad(root, "api->replica")).toBe("0.6");
    expect(root.querySelector('[data-node="api"] title')!.textContent).toMatch(/DB is down/);
    click(db);
    expect(state(root, "db")).toBe("on");
    expect(state(root, "api")).toBe("on");
    expect(flowLoad(root, "api->replica")).toBe("0");
  });

  it("shift+click switches a node off (dimmed) rather than failed", async () => {
    const root = await doc("failover");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    click(root.querySelector('[data-node="replica"]')!, { shiftKey: true });
    expect(state(root, "replica")).toBe("off");
    expect(flowLoad(root, "db->replica")).toBe("0");
  });

  it("plays a scenario step by step with its note, on top of the base model", async () => {
    const root = await doc("failover");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    const select = root.querySelector<HTMLSelectElement>(".orrery-scenarios")!;
    select.value = "db-failover";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(state(root, "db")).toBe("failed");
    expect(root.querySelector(".orrery-note")!.textContent).toBe("Primary goes down");
    expect(root.querySelector(".orrery-step")!.textContent).toBe("1 / 3");
    click(root.querySelector(".orrery-next")!);
    expect(root.querySelector(".orrery-step")!.textContent).toBe("2 / 3");
    expect(flowLoad(root, "api->replica")).toBe("0.6");
    click(root.querySelector(".orrery-next")!);
    expect(state(root, "db")).toBe("degraded");
    click(root.querySelector(".orrery-prev")!);
    expect(state(root, "db")).toBe("failed");
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(state(root, "db")).toBe("on");
  });

  it("switches views with a morph and refits the camera", async () => {
    const root = await doc("grouped");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    const before = root.querySelector(".scene")!.getAttribute("transform");
    rt.showView("data-tier");
    vi.runAllTimers();
    const layers = [...root.querySelectorAll(".view")];
    expect(layers.map((l) => (l as HTMLElement).style.display)).toEqual(["none", ""]);
    expect(root.querySelector(".scene")!.getAttribute("transform")).not.toBe(before);
    const outline = [...root.querySelectorAll(".orrery-outline li")].map((li) => li.getAttribute("data-id"));
    expect(outline).toEqual(["data", "db", "replica"]);
    // failures set in one view carry over to the other, since the model is shared
    click(root.querySelector('.view:not([style*="display:none"]) [data-node="db"]')!);
    rt.showView("overview");
    vi.runAllTimers();
    expect(state(root, "db")).toBe("failed");
    expect(state(root, "api")).toBe("degraded");
  });

  it("outline click selects and zooms; keyboard navigates, fails and resets", async () => {
    const root = await doc("failover");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    const fit = root.querySelector(".scene")!.getAttribute("transform");
    click(root.querySelector('.orrery-outline li[data-id="api"]')!);
    vi.runAllTimers();
    expect(root.querySelector('[data-node="api"]')!.classList.contains("is-selected")).toBe(true);
    expect(root.querySelector(".scene")!.getAttribute("transform")).not.toBe(fit);
    key("ArrowDown");
    expect(root.querySelector('[data-node="db"]')!.classList.contains("is-selected")).toBe(true);
    key("f");
    expect(state(root, "db")).toBe("failed");
    key("f");
    expect(state(root, "db")).toBe("on");
    key("Escape");
    vi.runAllTimers();
    expect(root.querySelector(".is-selected")).toBeNull();
    expect(root.querySelector(".scene")!.getAttribute("transform")).toBe(fit);
  });

  it("reset clears every override and scenario", async () => {
    const root = await doc("failover");
    rt = boot(root, { size: { width: 1600, height: 900 } });
    click(root.querySelector('[data-node="db"]')!);
    click(root.querySelector(".orrery-reset")!);
    expect(state(root, "db")).toBe("on");
  });
});
