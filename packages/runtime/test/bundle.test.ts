import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { renderDocument, validate } from "@orrery-diagrams/core";
import { FakeLayoutEngine } from "@orrery-diagrams/core/testing";
import { RUNTIME_SOURCE } from "../src/index.js";

/**
 * The shipped artifact, not the TypeScript: render a real document with the minified runtime embedded, load it as an
 * SVG document, execute the bundle in that window (jsdom does not run SVG <script> elements on its own), and drive it.
 */
describe("minified runtime inside a rendered SVG document", () => {
  it("defines window.Orrery, mounts itself, selects a clicked entity without changing its state, switches views from the keyboard", async () => {
    const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid/own-vocabulary.json"), "utf8")));
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const svg = await renderDocument(r.model, new FakeLayoutEngine(), { runtime: RUNTIME_SOURCE });
    const dom = new JSDOM(svg, { contentType: "image/svg+xml", pretendToBeVisual: true, runScripts: "outside-only" });
    const doc = dom.window.document;
    const script = doc.querySelector("script:not([type])")!.textContent!;
    expect(script.length).toBe(RUNTIME_SOURCE.length); // CDATA splitting round-trips
    vm.runInContext(script, dom.getInternalVMContext());
    const q = (s: string) => doc.querySelector(s)!;
    const vis = (id: string) => [...doc.querySelectorAll<SVGGElement>(".view")].find((g) => g.style.display !== "none")!.querySelector(`[data-node="${id}"]`)!;
    // the bundle defines the global and mounted itself; there is no user interface inside the file
    const Orrery = (dom.window as unknown as { Orrery: { mount: unknown } }).Orrery;
    expect(typeof Orrery.mount).toBe("function");
    expect(doc.documentElement.getAttribute("data-mounted")).toBe("1");
    expect(q("foreignObject")).toBeNull();
    vis("seq-1").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    expect([vis("seq-1"), vis("match-a"), vis("edge")].map((e) => e.getAttribute("data-state"))).toEqual(["healthy", "healthy", "healthy"]); // a click selects; it never changes a state
    expect(vis("seq-1").classList.contains("is-selected")).toBe(true);
    doc.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "2", bubbles: true }));
    for (let i = 0; i < 50 && doc.querySelector<SVGGElement>('.view[data-view="eu-only"]')!.style.display === "none"; i++) await new Promise((res) => setTimeout(res, 20));
    expect([...doc.querySelectorAll<SVGGElement>(".view")].map((v) => `${v.getAttribute("data-view")}:${v.style.display || "shown"}`)).toEqual(["overview:none", "eu-only:shown", "matching:none"]);
    // the strip (R19) is the script's own drawing: the file as written has none, so an image tag shows none; opened
    // directly the engine draws it, and a tap on it does what the digit did
    expect(new JSDOM(svg, { contentType: "image/svg+xml" }).window.document.querySelector(".strip")).toBeNull();
    expect(q('.strip [data-strip="view"] text').textContent).toMatch(/· 2 of 3$/);
    q('.strip [data-strip="view"] [data-do="next"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    for (let i = 0; i < 50 && doc.querySelector<SVGGElement>('.view[data-view="matching"]')!.style.display === "none"; i++) await new Promise((res) => setTimeout(res, 20));
    expect(doc.querySelector<SVGGElement>('.view[data-view="matching"]')!.style.display).not.toBe("none");
    expect(q('.strip [data-strip="view"] text').textContent).toMatch(/· 3 of 3$/);
  });
});
