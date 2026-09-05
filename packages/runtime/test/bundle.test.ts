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
    const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid/own-vocabulary.json"), "utf8")));
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const svg = await renderDocument(r.model, new FakeLayoutEngine(), { runtime: RUNTIME_SOURCE });
    const dom = new JSDOM(svg, { contentType: "image/svg+xml", pretendToBeVisual: true, runScripts: "outside-only" });
    const doc = dom.window.document;
    const script = doc.querySelector("script:not([type])")!.textContent!;
    expect(script.length).toBe(RUNTIME_SOURCE.length); // CDATA splitting round-trips
    vm.runInContext(script, dom.getInternalVMContext());
    const q = (s: string) => doc.querySelector(s)!;
    const vis = (id: string) => q(`.view:not([style*="display:none"]) [data-node="${id}"]`);
    expect(q(".orrery-panel")).toBeTruthy();
    expect(doc.querySelectorAll(".orrery-views option")).toHaveLength(3);
    const entities = r.model.components.length + r.model.groups.length;
    expect(doc.querySelectorAll(".orrery-outline li")).toHaveLength(entities);
    vis("seq-1").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    expect([vis("seq-1"), vis("match-a"), vis("edge")].map((e) => e.getAttribute("data-state"))).toEqual(["outage", "impaired", "impaired"]);
    const sel = q(".orrery-scenarios") as HTMLSelectElement;
    sel.value = "cell-drain"; sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    expect(vis("match-a").getAttribute("data-state")).toBe("drained");
    expect(q(".orrery-note").textContent).toMatch(/Cell A drained/);
    const views = q(".orrery-views") as HTMLSelectElement;
    views.value = "eu-only"; views.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    for (let i = 0; i < 50 && doc.querySelector<SVGGElement>('.view[data-view="eu-only"]')!.style.display === "none"; i++) await new Promise((res) => setTimeout(res, 20));
    expect([...doc.querySelectorAll<SVGGElement>(".view")].map((v) => `${v.getAttribute("data-view")}:${v.style.display || "shown"}`)).toEqual(["overview:none", "eu-only:shown", "matching:none"]);
  });
});
