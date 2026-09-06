import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeLayoutEngine, PULSE_PERIOD, applySet, render, renderExport, renderSvg, scopeModel, toLayoutGraph, validate, type Model, type LayoutResult } from "../src/index.js";

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
    const m = applySet(fixture("own-vocabulary"), { brownout: ["edge"], outage: ["seq-1"] });
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
  it("draws connections by their kind's line (R3), preset or the author's, never by name; replicas, tech and bidirectional arrows", async () => {
    const svg = await draw(fixture("alternatives"));
    expect(svg).toMatch(/<path class="edge edge-sync" data-edge="api->orders"/);
    expect(svg).toMatch(/<path class="edge edge-replication" data-edge="orders->replica"/);
    // the default kinds are ordinary kinds bound to preset lines
    expect(svg).toContain(".edge-async{stroke-dasharray:6 5}");
    expect(svg).toContain(".edge-replication{stroke-dasharray:2 4}");
    expect(svg).toContain(".edge-dataflow{stroke-width:3}");
    expect(svg).not.toMatch(/\.edge-sync\{/); // solid: nothing to add
    // a custom kind renders exactly its line style, and colours its flow
    const gossip = await draw(applySet(fixture("own-vocabulary"), {}));
    expect(gossip).toContain(".edge-gossip{stroke:#0891b2;stroke-dasharray:2 3}");
    expect(gossip).toMatch(/<path class="edge edge-gossip" data-edge="seq-1->seq-2" data-kind="gossip"/);
    expect(gossip).toMatch(/<path class="flow" data-flow="seq-1->seq-2" data-load="[\d.]+" d="[^"]+" style="[^"]*;stroke:#0891b2"/);
    const m = fixture("alternatives");
    const api = between(svg, 'data-node="api"');
    expect(api).toContain('class="replicas"');
    expect(api).toContain(">×3<");
    const own = await draw(fixture("own-vocabulary"));
    expect(own).toMatch(/marker-start="url\(#arrow-start\)"[^>]*data-edge="seq-1->seq-2"|data-edge="seq-1->seq-2"[^>]*marker-start="url\(#arrow-start\)"/);
    const tech = await draw(fixture("connected"));
    expect(between(tech, 'data-node="orders"')).toContain(">PostgreSQL 16</text>");
  });
  it("draws ghosts dimmed and dashed, and shows the author's reason as a tooltip", async () => {
    const m = fixture("grouped");
    const svg = await render(applySet(m, { failed: ["db"], degraded: ["api"] }, {}, { api: "reads from the replica" }), new FakeLayoutEngine(), { view: "data-tier" });
    expect(svg).toMatch(/\.node\[data-ghost\]\{[^}]*opacity/);
    expect(between(svg, 'data-node="api"')).toContain("<title>reads from the replica</title>");
    expect(between(svg, 'data-node="db"')).not.toContain("<title>"); // no reason given, none invented
  });
});

describe("renderSvg: legend (R9)", () => {
  it("lists every state used in the view with its description, and nothing when only the default is used", async () => {
    const plain = await draw(fixture("alternatives"));
    expect(plain).not.toContain('class="legend"');
    const m = applySet(fixture("alternatives"), { failed: ["orders"], degraded: ["api"] });
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
    expect(o).toContain('data-node="fraud" data-kind="function" data-state="failed"');
    expect(o).toContain('data-node="api" data-kind="service" data-state="on"'); // nothing is inferred
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

describe("renderSvg: closed groups (R11)", () => {
  it("draws a closed group the size of a component, its name centred with an expand mark, nothing inside, and connections re-attached to it", async () => {
    const m = fixture("drill-down");
    const svg = await render(m, new FakeLayoutEngine(), { view: "overview" });
    const payments = between(svg, 'data-group="payments"');
    expect(payments).toContain('data-collapsed="4"');
    expect(payments).toMatch(/data-bbox="[\d.]+ [\d.]+ [\d.]+ 48"/); // a component's height
    expect(payments).toMatch(/<g class="summary"><text class="summary-label"[^>]*>Payments<\/text><g class="expand-mark"/);
    expect(payments).not.toContain('class="group-label"');
    expect(svg).not.toContain('data-node="ledger"');
    expect(svg).not.toContain('data-group="pay-core"');
    expect(svg).not.toContain("data-lod");
    // the connection to a hidden member ends on the closed box, keeps its key, and is drawn once
    expect((svg.match(/data-edge="checkout->pay-api"/g) ?? []).length).toBe(1);
    expect((svg.match(/data-edge="pay-api->ledger"/g) ?? []).length).toBe(0); // internal: gone
    // a component outside any closed group is drawn as always
    expect(svg).toMatch(/<g class="node[^"]*" data-node="web"[^>]*>/);
  });
  it("an open group is drawn with its title and its members; a closed group inside it stays closed (any depth)", async () => {
    const n = fixture("nested-drill");
    const closed = await render(n, new FakeLayoutEngine());
    expect(closed).toContain('data-group="outer"');
    expect(closed).not.toContain('data-group="inner"');
    expect(closed).not.toContain('data-node="y"');
  });
});

describe("render: open, zoom and exports", () => {
  it("open renders the layout with exactly those groups open, as a still; zoom crops the picture to one entity", async () => {
    const n = fixture("nested-drill");
    const svg = await render(n, new FakeLayoutEngine(), { open: ["inner", "outer"] });
    expect(svg).toMatch(/<g class="view" data-view="overview" data-open="outer inner"/); // declaration order, whatever was given
    expect(svg).toContain('data-node="x"');
    expect(svg).not.toContain('class="camera"');
    expect(svg).not.toContain("<script");
    expect(svg).toMatch(/viewBox="0 0 [\d.]+ [\d.]+"/);
    const zoomed = await render(n, new FakeLayoutEngine(), { open: ["outer", "inner"], zoom: "inner" });
    const [bx, by, bw, bh] = zoomed.match(/data-group="inner" data-bbox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/)!.slice(1).map(Number) as [number, number, number, number];
    expect(zoomed).toContain(`viewBox="${Math.max(0, bx - 24)} ${Math.max(0, by - 24)} ${bw + 48} ${bh + 48}"`);
    await expect(render(n, new FakeLayoutEngine(), { open: ["app"] })).rejects.toThrow(/"app" is not a closed group in view "overview"/);
    await expect(render(n, new FakeLayoutEngine(), { zoom: "x" })).rejects.toThrow(/"x" is not drawn in view "overview" with everything closed/);
  });
  it("renderExport maps every kind of export onto render", async () => {
    const a = fixture("alternatives");
    const by = Object.fromEntries(a.exports.map((x) => [x.id, x]));
    expect(await renderExport(a, new FakeLayoutEngine(), by["overview"]!)).toBe(await render(a, new FakeLayoutEngine(), { view: "overview" }));
    expect(await renderExport(a, new FakeLayoutEngine(), by["orders-down"]!)).toContain('data-node="orders" data-kind="database" data-state="failed"');
    expect(await renderExport(a, new FakeLayoutEngine(), by["failover-loop"]!)).toMatch(/orrery-play-overview-0 10s step-end infinite/);
    const whatIf = await renderExport(a, new FakeLayoutEngine(), by["what-if"]!);
    expect(whatIf).toContain('data-node="fraud" data-kind="function" data-state="failed"');
    expect(whatIf).toContain("<title>no fraud scoring</title>");
    const n = fixture("nested-drill");
    expect(await renderExport(n, new FakeLayoutEngine(), n.exports[3]!)).toContain('class="camera"');
    const inner = await renderExport(n, new FakeLayoutEngine(), n.exports[2]!);
    expect(inner).toMatch(/data-open="outer inner"/);
    const whole = await render(n, new FakeLayoutEngine(), { open: ["outer", "inner"] });
    const width = (svg: string) => Number(svg.match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) /)![1]);
    expect(width(inner)).toBeLessThan(width(whole)); // zoomed to inner
  });
});

describe("render: a tour is one drawing with a camera (R12)", () => {
  it("is one drawing that moves: a layout per set of open groups, entities slide and resize, edges swap, states crossfade, the camera closes on the focus", async () => {
    const svg = await render(fixture("drill-down"), new FakeLayoutEngine(), { tour: true });
    // the stage is the size of the whole-system layout, and the camera at rest fits it exactly (scale 1); the still carries that as an attribute
    const [, sw, sh] = svg.match(/<g class="camera" data-stage="([\d.]+) ([\d.]+)" transform="translate\([\d.]+ [\d.]+\) scale\(1\) translate\([\d.-]+ [\d.-]+\)" style="animation:orrery-camera 16s linear infinite">/)!.map(Number) as [unknown, number, number];
    // the camera moves only in the middle phase of each transition: 4.3 s → 5.2 s (26.88 % → 32.5 %) and 12.3 s → 13.2 s
    const cam = svg.match(/@keyframes orrery-camera\{.*?\}\}(?=\n|<)/)![0];
    const rest = `translate\\(${sw / 2}px, ${sh / 2}px\\) scale\\(1\\) translate\\(-${sw / 2}px, -${sh / 2}px\\)`;
    expect(cam).toMatch(new RegExp(`^@keyframes orrery-camera\\{0%\\{transform:${rest}\\}26\\.88%\\{animation-timing-function:ease-in-out;transform:${rest}\\}32\\.5%\\{transform:translate\\([\\d.-]+px, [\\d.-]+px\\) scale\\([\\d.]+\\) translate\\([\\d.-]+px, [\\d.-]+px\\)\\}`));
    expect(cam).toMatch(new RegExp(`76\\.88%\\{animation-timing-function:ease-in-out;transform:translate[^}]*\\}82\\.5%\\{transform:${rest}\\}100%\\{transform:${rest}\\}\\}`));
    // the payments frame slides and grows in the same phase, from a component-sized box to its open frame
    const pos = svg.match(/@keyframes orrery-pos-payments\{([^}]*\}[^}]*\}[^}]*\}[^}]*\}[^}]*\}[^}]*\})/)![1]!;
    expect(pos).toMatch(/^0%\{transform:translate\([\d.]+px, [\d.]+px\)\}26\.88%\{animation-timing-function:ease-in-out;transform:translate\([\d.]+px, [\d.]+px\)\}32\.5%\{/);
    const size = svg.match(/@keyframes orrery-size-payments\{0%\{width:([\d.]+)px;height:48px\}26\.88%\{[^}]*\}32\.5%\{width:([\d.]+)px;height:([\d.]+)px\}/)!;
    expect(Number(size[2])).toBeGreaterThan(Number(size[1]));
    expect(Number(size[3])).toBeGreaterThan(48);
    // the camera's fixed point is the open payments frame: its centre maps to the stage centre
    const t = cam.match(/32\.5%\{transform:translate\(([\d.-]+)px, ([\d.-]+)px\) scale\(([\d.]+)\) translate\(([\d.-]+)px, ([\d.-]+)px\)/)!.slice(1).map(Number);
    const [px, py] = svg.match(/@keyframes orrery-pos-payments\{[^}]*\}[^}]*\}32\.5%\{transform:translate\(([\d.]+)px, ([\d.]+)px\)/)!.slice(1).map(Number) as [number, number];
    expect(t[0]).toBeCloseTo(sw / 2, 0); expect(t[1]).toBeCloseTo(sh / 2, 0);
    expect(t[3]).toBeCloseTo(-(px + Number(size[2]) / 2), 0); expect(t[4]).toBeCloseTo(-(py + Number(size[3]) / 2), 0);
    expect(t[2]).toBeCloseTo(Math.min(sw / (Number(size[2]) + 48), sh / (Number(size[3]) + 48)), 3);
    // members appear once the camera has settled and are gone before it leaves: ledger is in scenes 1 and 2 only
    expect(svg).toMatch(/@keyframes orrery-show-ledger\{0%\{opacity:0\}32\.5%\{opacity:0\}34\.38%\{opacity:1\}75%\{opacity:1\}76\.88%\{opacity:0\}100%\{opacity:0\}\}/);
    expect(svg).toMatch(/<g class="entity" data-t0="0" style="animation:orrery-show-ledger 16s linear infinite"><g class="node kind-database" data-node="ledger"/);
    expect(svg).toMatch(/<g class="entity" data-t0="1" style="animation:orrery-show-web 16s linear infinite">/);
    // the closed summary and the open title swap in the staged phases
    expect(svg).toMatch(/@keyframes orrery-open-payments\{0%\{opacity:0\}32\.5%\{opacity:0\}34\.38%\{opacity:1\}75%\{opacity:1\}76\.88%\{opacity:0\}100%\{opacity:0\}\}/);
    // states are variants that crossfade at the scenario moment (scene 2, 50 %)
    expect(svg).toMatch(/@keyframes orrery-var-ledger-failed\{0%\{opacity:0\}50%\{opacity:0\}59\.38%\{opacity:1\}100%\{opacity:1\}\}/);
    expect(svg).toMatch(/<g class="variant st-failed" data-state="failed" data-t0="0" style="animation:orrery-var-ledger-failed 16s linear infinite">/);
    // edges: one set per distinct drawing; the closed and open layouts differ, so they swap in the staged phases
    const sets = [...svg.matchAll(/<g class="edges" data-edges="(\d)" data-t0="([01])"/g)].map((m) => [m[1], m[2]]);
    expect(sets.length).toBeGreaterThanOrEqual(2);
    expect(sets[0]).toEqual(["0", "1"]);
    expect(svg).toMatch(/@keyframes orrery-edges-0\{0%\{opacity:1\}25%\{opacity:1\}26\.88%\{opacity:0\}/);
    // captions per scene, staged
    expect(svg).toContain(">The ledger fails. The API runs reduced on the replica.</text>");
    expect(svg).toMatch(/@keyframes orrery-caption-1\{0%\{opacity:0\}32\.5%\{opacity:0\}34\.38%\{opacity:1\}50%\{opacity:1\}51\.88%\{opacity:0\}100%\{opacity:0\}\}/);
    // the legend is a fixed strip below the stage, one variant per distinct legend
    expect(svg).toMatch(/<g class="legend-variant" data-t0="0" style="animation:orrery-legend-\d 16s linear infinite"><g class="legend"/);
    expect(svg.indexOf('class="legend-variant"')).toBeGreaterThan(svg.indexOf("</g>\n</g>\n<g class=\"legend-variant\"") > 0 ? 0 : svg.indexOf('<g class="camera"'));
  });
  it("a closed group inside a closed group: a scene opens both and zooms on the inner one; each layout is its own (R11, R12)", async () => {
    const svg = await render(fixture("nested-drill"), new FakeLayoutEngine(), { tour: true });
    // y (in outer) is in scenes 2 and 3; x (in inner) only in scene 3
    expect(svg).toMatch(/@keyframes orrery-show-y\{0%\{opacity:0\}32\.5%\{opacity:0\}34\.38%\{opacity:1\}75%\{opacity:1\}76\.88%\{opacity:0\}100%\{opacity:0\}\}/);
    expect(svg).toMatch(/@keyframes orrery-show-x\{0%\{opacity:0\}57\.5%\{opacity:0\}59\.38%\{opacity:1\}75%\{opacity:1\}76\.88%\{opacity:0\}100%\{opacity:0\}\}/);
    // inner appears closed in scene 2 and opens in scene 3: its frame grows in the move of scene 3
    expect(svg).toMatch(/@keyframes orrery-show-inner\{0%\{opacity:0\}32\.5%\{opacity:0\}34\.38%\{opacity:1\}/);
    const size = svg.match(/@keyframes orrery-size-inner\{0%\{width:[\d.]+px;height:48px\}51\.88%\{[^}]*\}57\.5%\{width:[\d.]+px;height:([\d.]+)px\}/)!;
    expect(Number(size[1])).toBeGreaterThan(48);
    // the camera closes on inner in scene 3
    const cam = svg.match(/@keyframes orrery-camera\{.*?\}\}(?=\n|<)/)![0];
    expect(cam).toMatch(/51\.88%\{animation-timing-function:ease-in-out;transform:translate[^}]*\}57\.5%\{transform:translate\([\d.-]+px, [\d.-]+px\) scale\([\d.]+\) translate/);
    // three layouts, three edge drawings
    expect((svg.match(/<g class="edges" data-edges=/g) ?? []).length).toBe(3);
  });
  it("scenes across different views fall back to a crossfade between whole views", async () => {
    const svg = await render(fixture("drill-down"), new FakeLayoutEngine(), { tour: { views: ["overview", "payments"], seconds: 3 } });
    const frames = [...svg.matchAll(/<g class="tour" data-frame="(\d)" data-view="([^"]+)"/g)];
    expect(frames.map((f) => f[2])).toEqual(["overview", "payments"]);
    expect(svg).not.toContain("orrery-camera");
  });
});

describe("renderSvg: icon glyphs and namespaced kinds (R13)", () => {
  it("draws an icon glyph as a nested svg in the glyph slot and escapes the kind's colon in the stylesheet", async () => {
    const svg = await draw(inline({ kinds: { use: ["aws"], components: { "aws:s3": { box: { fill: "#fff7ed" } } } }, components: [{ id: "a", label: "Assets", kind: "aws:s3" }, { id: "b", label: "API", kind: "service" }] }));
    const node = between(svg, 'data-node="a"');
    expect(svg).toContain('class="node kind-aws:s3 st-on" data-node="a"');
    expect(node).toMatch(/<svg class="icon" x="10" y="\d+(\.\d+)?" width="20" height="20" viewBox="0 0 64 64">/);
    expect(node).toContain('fill="#7aa116"');
    expect(node).not.toContain('class="glyph"');
    expect(svg).toContain(".kind-aws\\:s3 .node-box{fill:#fff7ed}");
    expect(between(svg, 'data-node="b"')).not.toContain("<svg");
  });
});

describe("renderSvg: shapes (R14)", () => {
  it("draws a corner shape as a rect and a path shape as a scaled path, both as the node-box; pads move the glyph and label in", async () => {
    const svg = await draw(inline({ components: [{ id: "web", label: "Storefront", kind: "client" }, { id: "db", label: "Orders", kind: "database" }, { id: "api", label: "API" }] }));
    const web = between(svg, 'data-node="web"');
    expect(web).toMatch(/<rect class="node-box" width="\d+" height="48" rx="24"\/>/);
    const db = between(svg, 'data-node="db"');
    expect(db).toMatch(/<path class="node-box" d="M0 7\.2A[\d.]+ 7\.2 0 0 1 [\d.]+ 7\.2V52\.8A/);
    expect(db).not.toContain("<rect");
    expect(db).toMatch(/<g class="glyph" transform="translate\(18 /); // 12 + pad.x 6
    expect(between(svg, 'data-node="api"')).toMatch(/<rect class="node-box" width="\d+" height="48" rx="8"\/>/);
  });
  it("draws a custom shape from shapes and stacks replicas as copies of the outline", async () => {
    const svg = await draw(inline({ shapes: { define: { chevron: { path: "M0 0H85L100 50 85 100H0L15 50Z", pad: { x: 16, y: 0 } } } }, kinds: { components: { stage: { shape: "chevron" } } }, components: [{ id: "s", label: "Ingest", kind: "stage", replicas: 2 }] }));
    const s = between(svg, 'data-node="s"');
    const w = Number(s.match(/data-bbox="\S+ \S+ (\S+) /)![1]);
    expect(s).toContain(`<path class="node-box" d="M0 0H${Math.round(w * 0.85 * 10) / 10}L${w} 24 ${Math.round(w * 0.85 * 10) / 10} 48H0L${Math.round(w * 0.15 * 10) / 10} 24Z"/>`);
    expect(s.match(/class="replica-box"/g)).toHaveLength(2);
    expect(s).toContain('<g transform="translate(6 -6)"><path class="replica-box"');
    expect(svg).not.toContain(".replicas rect");
  });
});

describe("renderSvg: group shapes (R14)", () => {
  it("draws an open group's frame as its kind's shape with the title moved in by the pad, and a closed one at node size", async () => {
    const m = fixture("shapes");
    const svg = await draw(m);
    const own = between(svg, 'data-group="own"');
    expect(own).toMatch(/<path class="group-box" data-shape="M20 100A20 20 0 0 1 10 62[^"]*" d="M[\d.]+ [\d.]+A/);
    expect(own).not.toContain("<rect");
    expect(own).toMatch(/<text class="group-label centred" x="[\d.]+" y="28">Your own<\/text>/); // centred on a path frame
    expect(between(svg, 'data-group="presets"')).toContain('<text class="group-label centred" x="'); // card is a path too
    expect(between(svg, 'data-group="presets"')).toMatch(/<path class="group-box" data-shape="M12 0H100V100H0V12Z" d="M[\d.]+ 0H/);
    const closed = await draw(scopeModel(m, m.views[1]!));
    const box = between(closed, 'data-group="own"');
    expect(box).toMatch(/data-bbox="\S+ \S+ \S+ 72"/); // 48 + 2 × 12
    expect(box).toMatch(/<path class="group-box" data-shape="[^"]+" d="M[\d.]+ 72A/); // the base at the full height of 72
    expect(box).toContain('class="summary"');
  });
  it("in a tour, a shaped frame's size track animates its path data", async () => {
    const m = inline({ kinds: { groups: { pipeline: { shape: "hexagon" } } }, groups: [{ id: "g", kind: "pipeline" }], components: [{ id: "a", group: "g" }, { id: "b" }], connections: [{ from: "b", to: "g" }], views: [{ id: "v", collapse: ["g"] }], tour: { seconds: 2, scenes: [{ view: "v" }, { view: "v", open: ["g"] }] } });
    const svg = await render(m, new FakeLayoutEngine(), { tour: true });
    expect(svg).toMatch(/@keyframes orrery-size-g\{0%\{d:path\("M[\d.]+ 0H[\d.]+L[\d.]+ 24 [\d.]+ 48H[\d.]+L0 24Z"\)\}/);
    expect(svg).toMatch(/<path class="group-box" data-shape="M15 0H85L100 50 85 100H15L0 50Z" d="M[^"]+" style="animation:orrery-size-g /);
  });
});
