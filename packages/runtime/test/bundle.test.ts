import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { FakeLayoutEngine, renderDocument, validate } from "@orrery/core";
import { RUNTIME_SOURCE } from "../src/index.js";

/**
 * The shipped artifact, not the TypeScript: render a real document with the minified runtime embedded, load it as an
 * SVG document, execute the bundle in that window (jsdom does not run SVG <script> elements on its own), and drive it.
 */
describe("minified runtime inside a rendered SVG document", () => {
  it("auto-boots, propagates a click, plays a scenario and switches views", async () => {
    const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid/checkout.json"), "utf8")));
    if (!r.ok) throw new Error();
    const svg = await renderDocument(r.diagram, new FakeLayoutEngine(), { runtime: RUNTIME_SOURCE });
    const dom = new JSDOM(svg, { contentType: "image/svg+xml", pretendToBeVisual: true, runScripts: "outside-only" });
    const doc = dom.window.document;
    const script = doc.querySelectorAll("script")[1]!.textContent!;
    expect(script.length).toBe(RUNTIME_SOURCE.length); // CDATA splitting round-trips
    vm.runInContext(script, dom.getInternalVMContext());
    const q = (s: string) => doc.querySelector(s)!;
    const vis = (id: string) => q(`.view:not([style*="display:none"]) [data-node="${id}"]`);
    expect(q(".orrery-panel")).toBeTruthy();
    expect(doc.querySelectorAll(".orrery-views option")).toHaveLength(3);
    expect(doc.querySelectorAll(".orrery-outline li")).toHaveLength(16);
    vis("db").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    expect([vis("db"), vis("api"), vis("worker"), vis("cdn")].map((e) => e.getAttribute("data-state"))).toEqual(["failed", "degraded", "failed", "degraded"]);
    const sel = q(".orrery-scenarios") as HTMLSelectElement;
    sel.value = "psp-outage"; sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    expect(vis("psp").getAttribute("data-state")).toBe("failed");
    expect(q(".orrery-note").textContent).toBe("Provider returns 5xx");
    const views = q(".orrery-views") as HTMLSelectElement;
    views.value = "data"; views.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await new Promise((res) => setTimeout(res, 500));
    expect([...doc.querySelectorAll<SVGGElement>(".view")].map((v) => `${v.getAttribute("data-view")}:${v.style.display || "shown"}`)).toEqual(["overview:none", "data:shown", "region:none"]);
  });
});
