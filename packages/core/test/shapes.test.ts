import { describe, expect, it } from "vitest";
import { SHAPE_PRESETS, measureComponent, scalePath, scopeModel, toLayoutGraph, validate, type Model } from "../src/index.js";

const inline = (input: unknown): Model => { const r = validate(input); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.model; };

describe("shapes: vocabulary (R14)", () => {
  it("ships eleven presets and binds the classic ones to the default kinds", () => {
    const m = inline({ components: [{ id: "a" }] });
    expect(Object.keys(m.shapes)).toEqual(["box", "sharp", "pill", "ellipse", "cylinder", "hexagon", "diamond", "parallelogram", "document", "card", "cloud"]);
    expect(Object.keys(m.shapes)).toEqual([...SHAPE_PRESETS]);
    expect(m.shapes.box).toEqual({ name: "box", corner: 8, pad: { x: 0, y: 0 } });
    expect(m.shapes.pill!.corner).toBe("round");
    expect(m.shapes.cylinder!.path).toMatch(/^M/);
    expect(m.shapes.diamond!.pad).toEqual({ x: 36, y: 14 });
    const shape = (k: string) => m.kinds.components[k]!.shape;
    expect([shape("database"), shape("queue"), shape("gateway"), shape("client"), shape("external")]).toEqual(["cylinder", "parallelogram", "hexagon", "pill", "cloud"]);
    expect(shape("service")).toBeUndefined(); // drawn as box
  });
  it("defines, overrides and replaces like states; a kind names a shape", () => {
    const m = inline({ shapes: { define: { chevron: { path: "M0 0H85L100 50 85 100H0L15 50Z", pad: { x: 16, y: 0 }, description: "A stage" }, box: { corner: 2 } } }, kinds: { components: { stage: { shape: "chevron" } } }, components: [{ id: "a", kind: "stage" }] });
    expect(m.shapes.chevron).toEqual({ name: "chevron", path: "M0 0H85L100 50 85 100H0L15 50Z", pad: { x: 16, y: 0 }, description: "A stage" });
    expect(m.shapes.box).toEqual({ name: "box", corner: 2, pad: { x: 0, y: 0 } });
    expect(m.kinds.components.stage!.shape).toBe("chevron");
    const r = inline({ shapes: { replace: true, define: { box: { corner: 0 } } }, components: [{ id: "a" }] });
    expect(Object.keys(r.shapes)).toEqual(["box"]);
  });
  it("a pack's shapes come in with kinds.use, under the pack's prefix", () => {
    // no shipped pack defines shapes yet; the merge is exercised through the loader's shape of a pack
    const m = inline({ kinds: { use: ["aws"] }, components: [{ id: "a", kind: "aws:s3" }] });
    expect(m.kinds.components["aws:s3"]!.shape).toBeUndefined();
    expect(m.shapes.box).toBeDefined();
  });
});

describe("shapes: measure and scale", () => {
  it("adds the shape's pad to the box", () => {
    const m = inline({ kinds: { components: { d: { shape: "diamond" }, b: { shape: "box" } } }, components: [{ id: "d", label: "Orders", kind: "d" }, { id: "b", label: "Orders", kind: "b" }] });
    const [d, b] = m.components.map((c) => measureComponent(c, m));
    expect(d!.width - b!.width).toBe(72);
    expect(d!.height - b!.height).toBe(28);
  });
  it("scales path data from the unit box to a size, command by command", () => {
    expect(scalePath("M0 0H100V100H0Z", 200, 50)).toBe("M0 0H200V50H0Z");
    expect(scalePath("M50 0L100 50 50 100 0 50Z", 80, 40)).toBe("M40 0L80 20 40 40 0 20Z");
    expect(scalePath("M0 12A50 12 0 0 1 100 12V88", 100, 50)).toBe("M0 6A50 6 0 0 1 100 6V44");
    expect(scalePath("m10 10 l20 0 q5 5 10 10 c1 2 3 4 5 6 t2 2 s1 1 2 2 h5 v5 z", 200, 100)).toBe("m20 10l40 0q10 5 20 10c2 2 6 4 10 6t4 2s2 1 4 2h10v5z");
    expect(scalePath("M33.333 0H66.666", 10, 10)).toBe("M3.3 0H6.7");
  });
});

describe("shapes: groups (R14)", () => {
  it("a group kind names a shape; unknown names are errors; the shape's pad reaches the layout, open and closed", () => {
    const m = inline({ kinds: { groups: { pipeline: { shape: "cloud" } } }, groups: [{ id: "g", kind: "pipeline" }, { id: "c", kind: "pipeline" }, { id: "t" }], components: [{ id: "a", group: "g" }, { id: "b", group: "c" }], views: [{ id: "v", collapse: ["c"] }] });
    expect(m.kinds.groups.pipeline!.shape).toBe("cloud");
    const graph = toLayoutGraph(m);
    expect(graph.groups!.find((g) => g.id === "g")!.pad).toEqual({ x: 16, y: 12 });
    expect(graph.groups!.find((g) => g.id === "t")!.pad).toBeUndefined();
    const closed = toLayoutGraph(scopeModel(m, m.views[0]!));
    const plain = toLayoutGraph(scopeModel(inline({ groups: [{ id: "c" }], components: [{ id: "b", group: "c" }], views: [{ id: "v", collapse: ["c"] }] }), { id: "v", title: "v", type: "topology", collapse: ["c"] }));
    expect(closed.groups!.find((g) => g.id === "c")!.emptySize!.width - plain.groups!.find((g) => g.id === "c")!.emptySize!.width).toBe(32);
    expect(closed.groups!.find((g) => g.id === "c")!.emptySize!.height - plain.groups!.find((g) => g.id === "c")!.emptySize!.height).toBe(24);
    const r = validate({ kinds: { groups: { x: { shape: "blob" } } }, groups: [{ id: "g", kind: "x" }], components: [{ id: "a" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.toString())).toEqual(['/kinds/groups/x/shape: unknown shape "blob"; known: box, sharp, pill, ellipse, cylinder, hexagon, diamond, parallelogram, document, card, cloud']);
  });
});
