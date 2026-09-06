import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeLayoutEngine, layoutSequence, render, renderDocument, renderExport, scopeModel, validate, type Model } from "../src/index.js";

const fixture = (name: string): Model => { const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid", `${name}.json`), "utf8"))); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.model; };
const between = (svg: string, start: string) => svg.slice(svg.indexOf(start), svg.indexOf("\n</g>", svg.indexOf(start)));
const m = fixture("sequence");
const seq = m.views.find((v) => v.id === "checkout")!;

describe("sequence views: the model (R17)", () => {
  it("normalises a sequence view: messages with the connection's kind unless given, reply false by default, play with seconds", () => {
    expect(seq.type).toBe("sequence");
    expect(seq.messages!.map((x) => [x.from, x.to, x.kind, x.reply])).toEqual([["web", "api", "sync", false], ["api", "db", "sync", false], ["db", "api", "sync", true], ["api", "sessions", "async", false], ["api", "api", "sync", false], ["api", "web", "sync", true]]);
    expect(seq.play).toEqual({ seconds: 1 });
    expect(m.views.find((v) => v.id === "overview")!.type).toBe("topology");
    expect(m.views.filter((v) => v.type === "sequence")).toHaveLength(2);
  });
});

describe("sequence views: layout (R17)", () => {
  const s = layoutSequence(m, seq);
  it("orders participants by first appearance, spaces columns by the labels between them, and pairs activations", () => {
    expect(s.participants.map((p) => p.id)).toEqual(["web", "api", "db", "sessions"]);
    const xs = s.participants.map((p) => p.box.x + p.box.width / 2);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(s.messages).toHaveLength(6);
    expect(s.messages.map((x) => x.y)).toEqual([...s.messages.map((x) => x.y)].sort((a, b) => a - b));
    expect(s.messages[4]!.self).toBe(true);
    // api is activated by the POST and released by the 201; db by the insert and released by ok; sessions never replies
    const act = (id: string) => s.activations.filter((a) => a.id === id).map((a) => [a.y0 <= s.messages[0]!.y + 1, a.y1]);
    expect(s.activations.map((a) => a.id)).toEqual(expect.arrayContaining(["api", "db", "sessions"]));
    const api = s.activations.find((a) => a.id === "api")!, db = s.activations.find((a) => a.id === "db")!, sessions = s.activations.find((a) => a.id === "sessions")!;
    expect(api.y0).toBeLessThan(db.y0); expect(db.y1).toBeLessThan(api.y1);
    expect(sessions.y1).toBe(s.lifelineBottom); // no reply: active to the end
    expect(act("api").length).toBeGreaterThan(0);
    expect(s.width).toBeGreaterThan(xs[3]!);
  });
});

describe("sequence views: rendering (R17)", () => {
  const engine = () => new FakeLayoutEngine();
  it("draws heads as the entities' own boxes with their states, lifelines, activations and labelled messages in their kinds' lines", async () => {
    const svg = await render(m, engine(), { view: "checkout", scenario: "db-fails", step: 1 });
    expect(svg).toMatch(/<g class="node kind-database st-failed" data-node="db"/); // the head is the component, in the step's state
    expect(svg).toMatch(/<g class="group gk-cluster st-on" data-group="sessions"/); // a group participant
    expect((svg.match(/class="lifeline"/g) ?? []).length).toBe(4);
    expect((svg.match(/class="activation"/g) ?? []).length).toBeGreaterThanOrEqual(3);
    const msgs = [...svg.matchAll(/<g class="message( reply)?" data-message="(\d)"/g)].map((x) => [x[2], !!x[1]]);
    expect(msgs).toEqual([["0", false], ["1", false], ["2", true], ["3", false], ["4", false], ["5", true]]);
    expect(between(svg, 'data-message="3"')).toContain('class="edge edge-async"');
    expect(between(svg, 'data-message="0"')).toContain(">POST /checkout</text>");
    expect(between(svg, 'data-message="4"')).toMatch(/d="M[\d.]+ [\d.]+ h ?\d+ v ?\d+ h ?-\d+"/i); // the self loop
    expect(svg).toContain('class="legend"'); expect(svg).toContain("degraded");
    expect(svg).toContain('data-callout="db"'); // a callout at a participant
  });
  it("reveals messages one per period when the view plays, and a still shows them all", async () => {
    const played = await render(m, engine(), { view: "checkout" });
    expect(played).toMatch(/@keyframes orrery-message-0\{0%\{visibility:hidden\}[\d.]+%\{visibility:visible\}100%\{visibility:visible\}\}/);
    expect(played).toMatch(/<g class="message" data-message="0" data-t0="0" style="animation:orrery-message-0 7s step-end infinite"/); // 6 messages + a beat, 1 s each
    const still = await render(m, engine(), { view: "lookup", heading: true });
    expect(still).not.toContain("orrery-message-");
    expect(still).toContain('class="heading-title centred"'); // heading from the export applies to a sequence too
  }, 30_000);
  it("exports, crops to a participant, is its own document, and refuses a scenario play on it", async () => {
    const x = await renderExport(m, engine(), m.exports.find((e) => e.id === "lookup")!);
    expect(x).toContain('data-node="web"');
    const zoomed = await render(m, engine(), { view: "checkout", zoom: "api" });
    expect(Number(zoomed.match(/viewBox="[\d.]+ [\d.]+ ([\d.]+)/)![1])).toBeLessThan(400);
    const doc = await renderDocument(m, engine(), { runtime: "" }); // the topology views alone: a sequence is its own file
    expect(doc).not.toMatch(/data-view="checkout"|data-view="lookup"/);
    const own = await renderDocument(m, engine(), { runtime: "", view: "checkout" });
    expect(own).toMatch(/<g class="view" data-view="checkout" data-open=""/);
    expect(own).not.toMatch(/data-view="overview"|data-view="lookup"/);
    await expect(render(m, engine(), { view: "checkout", play: { scenario: "db-fails" } })).rejects.toThrow(/sequence view plays its messages/);
    expect(scopeModel(m, seq).views[0]!.type).toBe("sequence");
  }, 30_000);
});
