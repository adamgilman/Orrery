import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeLayoutEngine, PULSE_PERIOD, applySet, propagate, render, renderSvg, toLayoutGraph, validate, type Model, type LayoutResult } from "../src/index.js";

const fixture = (name: string): Model => { const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid", `${name}.json`), "utf8"))); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.model; };
const inline = (input: unknown): Model => { const r = validate(input); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.model; };
const laidOut = async (m: Model): Promise<LayoutResult> => new FakeLayoutEngine().layout(toLayoutGraph(m));
const draw = async (m: Model) => renderSvg(m, await laidOut(m));
const attr = (svg: string, tag: string, name: string): string[] => [...svg.matchAll(new RegExp(`<${tag}[^>]*\\s${name}="([^"]*)"`, "g"))].map((m) => m[1]!);
/** The element block starting at `start`, up to its own closing tag on its own line (nested groups close inline). */
const between = (svg: string, start: string) => svg.slice(svg.indexOf(start), svg.indexOf("\n</g>", svg.indexOf(start)));

describe("renderSvg: structure", () => {
  it("emits a standalone SVG sized to the layout with groups, edges, nodes in that order", async () => {
    const m = fixture("grouped"); const l = await laidOut(m); const svg = renderSvg(m, l);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain(`viewBox="0 0 ${l.width} ${l.height}"`);
    expect(attr(svg, "g", "data-node")).toEqual(["web", "api", "db", "replica"]);
    expect(attr(svg, "g", "data-group")).toEqual(["region", "app", "data"]);
    expect(svg.indexOf('class="groups"')).toBeLessThan(svg.indexOf('class="edges"'));
    expect(svg.indexOf('class="edges"')).toBeLessThan(svg.indexOf('class="nodes"'));
  });
  it("draws one edge and one flow per connection keyed by connection key, with arrowheads", async () => {
    const svg = await draw(fixture("grouped"));
    expect(attr(svg, "path", "data-edge")).toEqual(["web->api", "api->db", "api-reads", "db->replica"]);
    expect(attr(svg, "path", "data-flow")).toEqual(["web->api", "api->db", "api-reads", "db->replica"]);
    expect(svg).toContain('marker-end="url(#arrow)"');
    expect(svg).toContain(">HTTPS</text>");
  });
  it("escapes text, is deterministic and self-contained", async () => {
    const m = inline({ components: [{ id: "a", label: "<script>&\"x\"" }] });
    const svg = await draw(m);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;&amp;&quot;x&quot;");
    expect(await draw(fixture("grouped"))).toBe(await draw(fixture("grouped")));
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });
  it("matches the snapshot for grouped with the fake engine", async () => {
    expect(await draw(fixture("grouped"))).toMatchSnapshot();
  });
});

describe("renderSvg: looks and kinds (R8)", () => {
  it("styles by state look, never by name: a custom state renders its style object", async () => {
    const m = propagate(applySet(fixture("own-vocabulary"), { brownout: ["edge"], outage: ["seq-1"] }));
    const svg = await draw(m);
    expect(svg).toContain('data-node="edge" data-kind="gateway" data-state="brownout"');
    expect(svg).toMatch(/\.st-brownout \.node-box\{[^}]*stroke:#7c3aed/);
    expect(svg).toMatch(/\.st-brownout \.node-box\{[^}]*fill:#f5f3ff/);
    expect(svg).toMatch(new RegExp(`\\.st-brownout \\.node-box\\{[^}]*animation:orrery-pulse ${PULSE_PERIOD}s linear infinite`));
    expect(svg).toMatch(new RegExp(`\\.st-outage \\.node-box\\{[^}]*animation:orrery-pulse`));
    expect(svg).toMatch(/\.st-outage \.node-box\{[^}]*stroke:#dc2626/);
    expect(between(svg, 'data-node="edge"')).toContain('data-pulse="1"');
    expect(svg).not.toContain("node-state-failed");
  });
  it("draws preset and custom glyphs and custom frames", async () => {
    const svg = await draw(fixture("own-vocabulary"));
    expect(between(svg, 'data-node="match-a"')).toContain('<path d="M2 8h4l2-5 2 10 2-5h4"/>');
    expect(between(svg, 'data-node="ledger"')).toContain('<path d="M2 3.5h12l-1.5 10.5h-9z"/>'); // storage preset glyph
    expect(svg).toMatch(/\.gk-cell \.group-box\{[^}]*stroke:#0891b2/);
    expect(svg).toMatch(/\.gk-cell \.group-box\{[^}]*stroke-dasharray/);
    expect(svg).toContain('class="group gk-boundary st-healthy" data-group="settlement"');
  });
  it("marks connections that satisfy a need, draws replicas, tech and bidirectional arrows", async () => {
    const m = propagate(fixture("alternatives"));
    const svg = await draw(m);
    expect(svg).toMatch(/<path class="edge edge-sync need" data-edge="api->orders"/);
    expect(svg).toMatch(/<path class="edge edge-replication" data-edge="orders->replica"/);
    const api = between(svg, 'data-node="api"');
    expect(api).toContain('class="replicas"');
    expect(api).toContain(">×3<");
    const own = await draw(fixture("own-vocabulary"));
    expect(own).toMatch(/marker-start="url\(#arrow-start\)"[^>]*data-edge="seq-1->seq-2"|data-edge="seq-1->seq-2"[^>]*marker-start="url\(#arrow-start\)"/);
    const tech = await draw(fixture("connected"));
    expect(between(tech, 'data-node="orders"')).toContain(">PostgreSQL 16</text>");
  });
  it("draws ghosts dimmed and dashed, and explains propagated states as tooltips", async () => {
    const m = fixture("grouped");
    const svg = await render(propagate(applySet(m, { failed: ["db"] })), new FakeLayoutEngine(), { view: "data-tier" });
    expect(svg).toMatch(/\.node\[data-ghost\]\{[^}]*opacity/);
    expect(between(svg, 'data-node="api"')).toContain("<title>Orders DB unavailable, using Orders DB (replica)</title>");
  });
});

describe("renderSvg: legend (R9)", () => {
  it("lists every state used in the view with its description, and nothing when only the default is used", async () => {
    const plain = await draw(propagate(fixture("alternatives")));
    expect(plain).not.toContain('class="legend"');
    const m = propagate(applySet(fixture("alternatives"), { failed: ["orders"] }));
    const svg = await draw(m);
    const legend = between(svg, '<g class="legend"');
    expect(legend).toContain("failed");
    expect(legend).toContain("Broken");
    expect(legend).toContain("degraded");
    expect(legend).not.toContain(">on<");
  });
});

describe("render options", () => {
  it("applies a scenario step and titles with the note; applies --set style overrides", async () => {
    const m = fixture("alternatives");
    const s = await render(m, new FakeLayoutEngine(), { scenario: "orders-failover", step: 1 });
    expect(s).toContain('data-node="orders" data-kind="database" data-state="failed"');
    expect(s).toContain("<title>Checkout with alternatives - Orders DB failover (1/4): Primary goes down; reads move to the replica, API runs reduced</title>");
    const o = await render(m, new FakeLayoutEngine(), { set: { failed: ["fraud"] } });
    expect(o).toContain('data-node="api" data-kind="service" data-state="degraded"');
  });
});

describe("renderDocument / render: a view that plays a scenario (R10)", () => {
  it("emits one complete layer per step, base first, cycled by CSS with the declared period", async () => {
    const m = fixture("alternatives");
    const svg = await render(m, new FakeLayoutEngine(), { view: "failover-loop" });
    const steps = [...svg.matchAll(/<g class="step" data-step="(\d)" style="animation:orrery-play-failover-loop-(\d) (\d+)s step-end infinite">/g)];
    expect(steps.map((s) => s[1])).toEqual(["0", "1", "2", "3", "4"]); // base + 4 steps
    expect(steps.every((s) => s[3] === "10")).toBe(true); // 5 layers × 2 s
    expect(svg).toMatch(/@keyframes orrery-play-failover-loop-0\{0%\{visibility:visible\}20%\{visibility:hidden\}100%\{visibility:hidden\}\}/);
    expect(svg).toMatch(/@keyframes orrery-play-failover-loop-2\{0%\{visibility:hidden\}40%\{visibility:visible\}60%\{visibility:hidden\}100%\{visibility:hidden\}\}/);
    // each step layer is a complete render with its own states and legend
    const layer = (k: number) => svg.slice(svg.indexOf(`data-step="${k}"`), svg.indexOf(`data-step="${k + 1}"`) > 0 ? svg.indexOf(`data-step="${k + 1}"`) : svg.length);
    expect(layer(0)).toMatch(/data-node="orders"[^>]*data-state="on"/);
    expect(layer(1)).toMatch(/data-node="orders"[^>]*data-state="failed"/);
    expect(layer(3)).toMatch(/data-node="api"[^>]*data-state="failed"/);
    expect(layer(1)).toContain('class="legend"');
    expect(layer(1)).toContain(">Step 1 of 4: Primary goes down; reads move to the replica, API runs reduced</text>");
    expect(layer(0)).toContain(">Orders DB failover</text>");
  });
  it("keeps one layout for every step, so nothing moves between steps", async () => {
    const svg = await render(fixture("alternatives"), new FakeLayoutEngine(), { view: "failover-loop" });
    const positions = [...svg.matchAll(/data-node="api"[^>]*data-bbox="([^"]+)"/g)].map((m) => m[1]);
    expect(positions).toHaveLength(5);
    expect(new Set(positions).size).toBe(1);
  });
  it("--play overrides the view and defaults to three seconds", async () => {
    const svg = await render(fixture("alternatives"), new FakeLayoutEngine(), { play: { scenario: "orders-failover" } });
    expect(svg).toMatch(/orrery-play-overview-0 15s step-end infinite/);
  });
  it("a non-playing view has no step layers", async () => {
    const svg = await render(fixture("alternatives"), new FakeLayoutEngine());
    expect(svg).not.toContain('class="step"');
  });
});

describe("renderSvg: collapsed groups (R11)", () => {
  it("draws a closed box with the label and a count, and marks it as collapsed", async () => {
    const m = fixture("drill-down");
    const svg = await render(m, new FakeLayoutEngine(), { view: "overview" });
    expect(svg).toMatch(/<g class="group gk-boundary st-on collapsed" data-group="payments"[^>]*data-collapsed="4"/);
    const box = between(svg, 'data-group="payments"');
    expect(box).toContain(">Payments</text>");
    expect(box).toContain(">4 inside</text>");
    expect(svg).not.toContain('data-node="ledger"');
    expect(svg).toMatch(/data-edge="checkout->payments"/);
  });
});

describe("render: a tour of views (R12)", () => {
  it("emits one complete layer per view, sized to the largest, crossfaded by CSS with the declared period", async () => {
    const svg = await render(fixture("drill-down"), new FakeLayoutEngine(), { tour: { views: ["overview", "payments", "identity"], seconds: 4 } });
    const frames = [...svg.matchAll(/<g class="tour" data-frame="(\d)" data-view="([^"]+)" style="animation:orrery-tour-(\d) (\d+)s linear infinite">/g)];
    expect(frames.map((f) => f[2])).toEqual(["overview", "payments", "identity"]);
    expect(frames.every((f) => f[4] === "12")).toBe(true);
    // 12 s cycle, 1.2 s transitions = 10 % windows at each boundary; scene 1 enters at 33.3 % and leaves at 66.7 %
    expect(svg).toMatch(/@keyframes orrery-tour-1\{0%\{opacity:0;[^}]*\}33\.33%\{[^}]*opacity:0;[^}]*\}43\.33%\{opacity:1;transform:none\}66\.67%\{[^}]*opacity:1;transform:none\}76\.67%\{opacity:0;[^}]*\}100%\{opacity:0;[^}]*\}\}/);
    expect(svg).toMatch(/@keyframes orrery-tour-0\{0%\{opacity:0;[^}]*\}10%\{opacity:1;transform:none\}33\.33%\{[^}]*opacity:1;transform:none\}43\.33%\{opacity:0;[^}]*\}100%\{opacity:0;[^}]*\}\}/);
    expect(svg).toContain(">Inside Payments</text>");
    const [, w, h] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!;
    expect(Number(w)).toBeGreaterThan(0);
    expect(Number(h)).toBeGreaterThan(0);
    expect(svg).toContain('data-collapsed="4"'); // the overview frame is the closed one
    expect(svg).toContain('data-node="ledger"'); // the payments frame is open
  });
  it("uses the model's own tour when the file declares one: scenes with scenario moments, captions and per-scene timing", async () => {
    const svg = await render(fixture("drill-down"), new FakeLayoutEngine(), { tour: true });
    const frames = [...svg.matchAll(/<g class="tour" data-frame="(\d)" data-view="([^"]+)" style="animation:orrery-tour-\d (\d+)s linear infinite">/g)];
    expect(frames.map((f) => f[2])).toEqual(["overview", "payments", "payments", "overview"]);
    expect(frames[0]![3]).toBe("16");
    const frame = (k: number) => svg.slice(svg.indexOf(`data-frame="${k}"`), k < 3 ? svg.indexOf(`data-frame="${k + 1}"`) : svg.length);
    expect(frame(2)).toMatch(/data-node="ledger"[^>]*data-state="failed"/);
    expect(frame(2)).toMatch(/data-node="pay-api"[^>]*data-state="degraded"/);
    expect(frame(3)).toMatch(/data-group="payments"[^>]*data-state="degraded"/);
    expect(frame(3)).toContain(">Back outside: the closed box and the checkout that needs it are amber.</text>");
    // scenes are centred on the shared canvas by shifting their coordinates, never by a transform
    expect(frame(1)).not.toContain("<g transform=");
    const x = (k: number, id: string) => Number(frame(k).match(new RegExp(`data-node="${id}"[^>]*data-bbox="([\\d.]+)`))![1]);
    expect(x(1, "pay-api")).toBeGreaterThan(100); // the narrow payments view sits mid-canvas, not at the left edge
  });
  it("zooms into a collapsed group and back out, and crossfades everywhere else (R12)", async () => {
    const svg = await render(fixture("drill-down"), new FakeLayoutEngine(), { tour: true });
    const kf = (k: number) => svg.match(new RegExp(`@keyframes orrery-tour-${k}\\{.*?\\}\\}(?=\\n|<)`))![0];
    // scene 0 (overview, payments closed) → scene 1 (inside payments): overview zooms up around the box, detail grows from it
    expect(kf(0)).toMatch(/transform:translate\([\d.-]+px, [\d.-]+px\) scale\([\d.]+\) translate\([\d.-]+px, [\d.-]+px\)/);
    expect(kf(1)).toMatch(/transform:translate\([\d.-]+px, [\d.-]+px\) scale\(0\.[\d]+\) translate/);
    expect(kf(1)).toContain("animation-timing-function:ease-in-out");
    // the detail's start transform maps its own drawing onto the closed box
    const box = svg.slice(svg.indexOf('data-frame="0"')).match(/data-group="payments" data-bbox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/)!.slice(1).map(Number);
    const [bx, by, bw, bh] = box as [number, number, number, number];
    const start = kf(1).match(/transform:translate\(([\d.-]+)px, ([\d.-]+)px\) scale\(([\d.]+)\)/)!;
    expect(Number(start[1])).toBeCloseTo(bx + bw / 2, 0);
    expect(Number(start[2])).toBeCloseTo(by + bh / 2, 0);
    expect(Number(start[3])).toBeLessThan(1);
    // scene 1 → scene 2 is the same layout with a state change: a plain crossfade (the 100% stop only repeats the entry)
    const mid = kf(1).slice(kf(1).indexOf("opacity:1"), kf(1).indexOf("100%"));
    expect(mid).not.toMatch(/scale\(/);
    // scene 2 → scene 3 zooms back out: the detail shrinks into the box, the overview settles from the zoomed state
    expect(kf(2)).toMatch(/opacity:1;transform:none\}[\d.]+%\{opacity:0;transform:translate/);
    expect(kf(3)).toMatch(/opacity:0;transform:translate\([\d.-]+px, [\d.-]+px\) scale\([\d.]+\)/);
  });

  it("honours per-scene seconds in the keyframe timing", async () => {
    const m = fixture("drill-down");
    const svg = await render({ ...m, tour: { seconds: 2, scenes: [{ view: "overview", seconds: 6 }, { view: "payments", seconds: 2 }] } }, new FakeLayoutEngine(), { tour: true });
    expect(svg).toMatch(/orrery-tour-0 8s linear infinite/);
    // 8 s cycle: scene 0 holds 6 s, so it leaves at 75 % with a 1.2 s (15 %) transition
    expect(svg).toMatch(/@keyframes orrery-tour-0\{0%\{opacity:0;[^}]*\}15%\{opacity:1;transform:none\}75%\{[^}]*opacity:1;transform:none\}90%\{opacity:0;[^}]*\}100%\{opacity:0;[^}]*\}\}/);
  });
  it("rejects a tour naming an unknown view", async () => {
    await expect(render(fixture("drill-down"), new FakeLayoutEngine(), { tour: { views: ["overview", "nope"] } })).rejects.toThrow(/unknown view "nope"/);
  });
});
