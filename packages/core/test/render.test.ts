import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeLayoutEngine, PULSE_PERIOD, propagate, render, renderSvg, toLayoutGraph, validate, type Diagram, type LayoutResult } from "../src/index.js";

const fixture = (name: string): Diagram => {
  const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid", `${name}.json`), "utf8")));
  if (!r.ok) throw new Error(`fixture ${name} invalid`);
  return r.diagram;
};
const laidOut = async (d: Diagram): Promise<LayoutResult> => new FakeLayoutEngine().layout(toLayoutGraph(d));
const attr = (svg: string, tag: string, name: string): string[] =>
  [...svg.matchAll(new RegExp(`<${tag}[^>]*\\s${name}="([^"]*)"`, "g"))].map((m) => m[1]!);

describe("renderSvg", () => {
  it("emits a standalone SVG sized to the layout", async () => {
    const d = fixture("three-tier");
    const l = await laidOut(d);
    const svg = renderSvg(d, l);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain(`viewBox="0 0 ${l.width} ${l.height}"`);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });

  it("draws one node group per node with rect and label", async () => {
    const d = fixture("three-tier");
    const svg = renderSvg(d, await laidOut(d));
    expect(attr(svg, "g", "data-node")).toEqual(["web", "api", "db"]);
    expect(svg).toContain(">Web</text>");
    expect(svg).toContain(">API</text>");
    expect((svg.match(/<rect class="node-box"/g) ?? []).length).toBe(3);
  });

  it("draws one edge path per edge with arrowhead and data attributes", async () => {
    const d = fixture("three-tier");
    const svg = renderSvg(d, await laidOut(d));
    expect(attr(svg, "path", "data-edge")).toEqual(["web->api", "api->db"]);
    expect(svg).toContain('marker-end="url(#arrow)"');
    expect(svg).toContain("<marker id=\"arrow\"");
  });

  it("defines the arrowhead in user space with orient=auto so every renderer draws it the same", async () => {
    // resvg (and some older renderers) ignore orient="auto-start-reverse" on vertical segments, drawing half a triangle.
    const d = fixture("three-tier");
    const marker = renderSvg(d, await laidOut(d)).match(/<marker[^>]*>/)![0];
    expect(marker).toContain('orient="auto"');
    expect(marker).toContain('markerUnits="userSpaceOnUse"');
    expect(marker).toContain('markerWidth="12"');
  });

  it("renders edge labels when present", async () => {
    const d = fixture("three-tier");
    const svg = renderSvg(d, await laidOut(d));
    expect(svg).toContain(">HTTPS</text>");
  });

  it("animates flow faster and thicker for higher load, and not at all for zero", async () => {
    const d = fixture("fan-out");
    const svg = renderSvg(d, await laidOut(d));
    const flows = [...svg.matchAll(/<path class="flow" data-flow="([^"]+)"[^>]*style="([^"]*)"/g)].map((m) => [m[1]!, m[2]!] as const);
    const style = (id: string) => Object.fromEntries(flows.find((f) => f[0] === id)![1].split(";").map((kv) => kv.split(":").map((s) => s.trim())));
    const full = style("s1->cache"), half = style("s3->cache"), zero = style("s2->cache");
    expect(parseFloat(full["animation-duration"]!)).toBeLessThan(parseFloat(half["animation-duration"]!));
    expect(parseFloat(full["stroke-width"]!)).toBeGreaterThan(parseFloat(half["stroke-width"]!));
    expect(zero["animation-duration"]).toBeUndefined();
    expect(svg).toContain("@keyframes orrery-flow");
  });

  it("escapes labels", async () => {
    const r = validate({ nodes: [{ id: "a", label: "<script>&\"x\"" }], edges: [] });
    if (!r.ok) throw new Error();
    const svg = renderSvg(r.diagram, await laidOut(r.diagram));
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;&amp;&quot;x&quot;");
  });

  it("is deterministic and uses no external resources", async () => {
    const d = fixture("three-tier");
    const a = renderSvg(d, await laidOut(d));
    const b = renderSvg(d, await laidOut(d));
    expect(a).toBe(b);
    expect(a).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(a).not.toContain("<script");
  });

  it("matches the snapshot for three-tier with the fake engine", async () => {
    const d = fixture("three-tier");
    expect(renderSvg(d, await laidOut(d))).toMatchSnapshot();
  });
});

describe("renderSvg: edge label placement", () => {
  it("draws the label at the engine's labelAt, centred, when provided", async () => {
    const d = fixture("three-tier");
    const l = await laidOut(d);
    l.edges["web->api"]!.labelAt = { x: 123.4, y: 56.7 };
    const svg = renderSvg(d, l);
    expect(svg).toMatch(/<text class="edge-label" x="123\.4" y="56\.7">HTTPS<\/text>/);
  });
});

describe("render", () => {
  it("runs measure, layout and render end to end", async () => {
    const svg = await render(fixture("minimal"), new FakeLayoutEngine());
    expect(svg).toContain('data-node="a"');
  });
});

describe("renderSvg: flow overlay stops short of the arrowhead", () => {
  it("trims the flow path so dashes never cover the marker", async () => {
    const d = fixture("three-tier");
    const svg = renderSvg(d, await laidOut(d));
    const edgeD = svg.match(/<path class="edge[^"]*" data-edge="[^"]*" data-kind="[^"]*" d="([^"]*)"/)![1]!;
    const flowD = svg.match(/<path class="flow" data-flow="[^"]*" data-load="[^"]*" d="([^"]*)"/)![1]!;
    const last = (p: string) => p.split(" L").at(-1)!.split(" ").map(Number);
    const [ex, ey] = last(edgeD), [fx, fy] = last(flowD);
    const gap = Math.hypot(ex! - fx!, ey! - fy!);
    expect(gap).toBeGreaterThanOrEqual(8);
    expect(gap).toBeLessThanOrEqual(14);
    expect(flowD.startsWith(edgeD.split(" L")[0]!)).toBe(true);
  });
});

describe("renderSvg: groups, kinds, edge kinds", () => {
  const grouped = () => fixture("grouped");
  it("draws group frames with labels, beneath edges and nodes, in hierarchy order", async () => {
    const d = grouped();
    const svg = renderSvg(d, await laidOut(d));
    expect(attr(svg, "g", "data-group")).toEqual(["region", "app", "data"]);
    expect(svg).toContain('<g class="group group-region" data-group="region"');
    expect(svg).toContain('<rect class="group-box"');
    expect(svg).toContain(">us-east-1</text>");
    expect(svg.indexOf('class="groups"')).toBeLessThan(svg.indexOf('class="edges"'));
    expect(svg.indexOf('class="edges"')).toBeLessThan(svg.indexOf('class="nodes"'));
  });
  it("tags nodes with their kind and draws a glyph for non-service kinds", async () => {
    const d = grouped();
    const svg = renderSvg(d, await laidOut(d));
    expect(svg).toContain('class="node node-database" data-node="db" data-kind="database"');
    expect(svg).toContain('class="node node-service" data-node="api" data-kind="service"');
    const dbGroup = svg.slice(svg.indexOf('data-node="db"'), svg.indexOf("</g>", svg.indexOf('data-node="db"')));
    expect(dbGroup).toContain('class="glyph"');
    const apiGroup = svg.slice(svg.indexOf('data-node="api"'), svg.indexOf("</g>", svg.indexOf('data-node="api"')));
    expect(apiGroup).not.toContain('class="glyph"');
  });
  it("styles base edges by kind", async () => {
    const d = grouped();
    const svg = renderSvg(d, await laidOut(d));
    expect(svg).toContain('<path class="edge edge-replication" data-edge="db->replica" data-kind="replication"');
    expect(svg).toContain('<path class="edge edge-sync" data-edge="web->api" data-kind="sync"');
    expect(svg).toMatch(/\.edge-async\{[^}]*stroke-dasharray/);
    expect(svg).toMatch(/\.edge-replication\{[^}]*stroke-dasharray/);
  });
  it("matches the snapshot for grouped with the fake engine", async () => {
    const d = grouped();
    expect(renderSvg(d, await laidOut(d))).toMatchSnapshot();
  });
});

describe("renderSvg: states", () => {
  const failed = async () => {
    const d = propagate(fixture("failover"), );
    return d;
  };
  it("tags nodes with their effective state and explains propagated ones", async () => {
    const base = fixture("failover");
    const d = propagate({ ...base, nodes: base.nodes.map((n) => (n.id === "db" ? { ...n, state: "failed" as const } : n)) });
    const svg = renderSvg(d, await laidOut(d));
    expect(svg).toContain('data-node="db" data-kind="database" data-state="failed"');
    expect(svg).toContain('class="node node-database node-state-failed"');
    expect(svg).toContain('class="node node-service node-state-degraded"');
    expect(svg).toContain('class="node node-external node-state-off"');
    const api = svg.slice(svg.indexOf('data-node="api"'), svg.indexOf("</g>", svg.indexOf('data-node="api"')));
    expect(api).toMatch(/<title>DB is down, using Replica<\/title>/);
  });
  it("styles failed, degraded and off nodes, and pulses failed ones with a fixed period", async () => {
    const d = await failed();
    const svg = renderSvg(d, await laidOut(d));
    expect(svg).toMatch(/\.node-state-failed \.node-box\{[^}]*stroke:#dc2626/);
    expect(svg).toMatch(/\.node-state-degraded \.node-box\{[^}]*stroke:#d97706/);
    expect(svg).toMatch(/\.node-state-off\{[^}]*opacity/);
    expect(svg).toMatch(new RegExp(`\\.node-state-failed \\.node-box\\{[^}]*animation:orrery-pulse ${PULSE_PERIOD}s linear infinite`));
    expect(svg).toContain("@keyframes orrery-pulse");
  });
  it("edges touching a down node carry no flow", async () => {
    const base = fixture("failover");
    const d = propagate({ ...base, nodes: base.nodes.map((n) => (n.id === "db" ? { ...n, state: "failed" as const } : n)) });
    const svg = renderSvg(d, await laidOut(d));
    expect(svg).toMatch(/data-flow="api->db" data-load="0"/);
    expect(svg).toMatch(/data-flow="api->replica" data-load="0.6"/);
  });
});

describe("render with a scenario", () => {
  it("applies the scenario step, propagates, and titles the SVG with the step note", async () => {
    const svg = await render(fixture("failover"), new FakeLayoutEngine(), { scenario: "db-failover", step: 1 });
    expect(svg).toContain('data-node="db" data-kind="database" data-state="failed"');
    expect(svg).toContain("<title>Failover — Primary DB fails (1/3): Primary goes down</title>");
  });
  it("propagates base-model states even without a scenario", async () => {
    const svg = await render(fixture("failover"), new FakeLayoutEngine());
    expect(svg).toContain('data-state="off"');
    expect(svg).toMatch(/data-flow="api->legacy" data-load="0"/);
  });
});
