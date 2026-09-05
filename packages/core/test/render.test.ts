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
