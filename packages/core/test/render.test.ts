import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeLayoutEngine, render, renderSvg, toLayoutGraph, validate, type Diagram, type LayoutResult } from "../src/index.js";

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
    l.edges.e0!.labelAt = { x: 123.4, y: 56.7 };
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
    const edgeD = svg.match(/<path class="edge" data-edge="[^"]*" d="([^"]*)"/)![1]!;
    const flowD = svg.match(/<path class="flow" data-flow="[^"]*" data-load="[^"]*" d="([^"]*)"/)![1]!;
    const last = (p: string) => p.split(" L").at(-1)!.split(" ").map(Number);
    const [ex, ey] = last(edgeD), [fx, fy] = last(flowD);
    const gap = Math.hypot(ex! - fx!, ey! - fy!);
    expect(gap).toBeGreaterThanOrEqual(8);
    expect(gap).toBeLessThanOrEqual(14);
    expect(flowD.startsWith(edgeD.split(" L")[0]!)).toBe(true);
  });
});
