// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const bin = join(import.meta.dirname, "../dist/main.js");
const fixtures = join(import.meta.dirname, "../../../fixtures");

/**
 * The sample page drives the engine through its interface: load index.html with orrery.js and app.js, answer its
 * fetch with the embedded diagram, and use its controls.
 */
describe("the embed's sample page", () => {
  it("builds its controls from the engine and drives it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orrery-"));
    const r = spawnSync("node", [bin, "embed", join(fixtures, "valid/drill-down.json"), "--out", dir], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const html = readFileSync(join(dir, "index.html"), "utf8").replace(/<script src="[^"]+"><\/script>\s*/g, "");
    const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: "outside-only", url: "http://localhost/" });
    const ctx = dom.getInternalVMContext();
    (dom.window as unknown as { fetch: unknown }).fetch = async (url: string) => ({ text: async () => readFileSync(join(dir, url), "utf8") });
    vm.runInContext(readFileSync(join(dir, "orrery.js"), "utf8"), ctx);
    expect(typeof (dom.window as unknown as { Orrery: { mount: unknown } }).Orrery.mount).toBe("function");
    vm.runInContext(readFileSync(join(dir, "app.js"), "utf8"), ctx);
    const doc = dom.window.document;
    const settled = async (ms = 50) => { await new Promise((res) => setTimeout(res, ms)); };
    for (let i = 0; i < 40 && !doc.querySelector("#diagram svg .view"); i++) await settled(25);
    expect(doc.querySelector("#diagram svg")).not.toBeNull();
    expect([...doc.querySelectorAll<HTMLOptionElement>("#view option")].map((o) => o.value)).toEqual(["overview", "payments", "identity"]);
    expect([...doc.querySelectorAll<HTMLOptionElement>("#scenario option")].map((o) => o.value)).toEqual(["", "ledger-fails"]);
    expect([...doc.querySelectorAll<HTMLButtonElement>("#states button")].map((b) => b.textContent)).toEqual(["on", "degraded", "failed", "off"]);
    expect([...doc.querySelectorAll<HTMLButtonElement>("#groups button")].map((b) => b.textContent)).toEqual(["Payments", "Identity"]); // the closed groups of the current view
    // the tour plays on mount; the sample shows that
    expect((doc.querySelector("#play") as HTMLButtonElement).disabled).toBe(true);
    (doc.querySelector("#stop") as HTMLButtonElement).click();
    expect((doc.querySelector("#play") as HTMLButtonElement).disabled).toBe(false);
    // a scenario from the select, stepped with the buttons, with its note
    const scenario = doc.querySelector("#scenario") as HTMLSelectElement;
    scenario.value = "ledger-fails"; scenario.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    expect(doc.querySelector("#step")!.textContent).toBe("1 / 1");
    expect(doc.querySelector("#note")!.textContent).toBe("Primary ledger goes down");
    expect(doc.querySelector('#diagram [data-group="payments"]')!.getAttribute("data-state")).toBe("degraded");
    // a click in the diagram selects; the state buttons act on the selection
    doc.querySelector('#diagram [data-node="web"]')!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    expect(doc.querySelector("#selected")!.textContent).toMatch(/^web: degraded/);
    (doc.querySelector('#states button[data-state="off"]') as HTMLButtonElement).click();
    expect(doc.querySelector('#diagram [data-node="web"]')!.getAttribute("data-state")).toBe("off");
    // drill down from the groups list, then back out
    (doc.querySelector("#groups button") as HTMLButtonElement).click();
    await settled(600);
    const shown = () => [...doc.querySelectorAll<SVGGElement>("#diagram .view")].find((g) => g.style.display !== "none")!;
    expect(shown().getAttribute("data-open")).toBe("payments");
    expect((doc.querySelector("#back") as HTMLButtonElement).disabled).toBe(false);
    (doc.querySelector("#back") as HTMLButtonElement).click();
    await settled(600);
    expect(shown().getAttribute("data-open")).toBe("");
  });
});
