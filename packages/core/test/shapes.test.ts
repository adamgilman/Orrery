import { describe, expect, it } from "vitest";
import { escaping, insideOutline, type Box } from "./outline.js";
import { pathExtent } from "./pathExtent.js";
import { validate, type Model } from "../src/index.js";
import { DEFAULT_SHAPES, SHAPE_PRESETS, closedGroupSlots, componentSlots, contentRect, measureClosedGroup, measureComponent, scalePath, scopeModel, textWidth, toLayoutGraph } from "../src/internal.js";

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
  it("a shape declares the rectangle its outline leaves clear; a redrawn outline does not inherit one (R18)", () => {
    const m = inline({ shapes: { define: { tag: { path: "M0 0H80L100 50 80 100H0Z", inner: [4, 10, 78, 90] }, cloud: { pad: { x: 30, y: 12 } }, diamond: { path: "M50 0L100 50 50 100 0 50Z" } } }, components: [{ id: "a" }] });
    expect(m.shapes.tag!.inner).toEqual([4, 10, 78, 90]);
    expect(m.shapes.cloud!.inner, "the same outline keeps its rectangle").toEqual(DEFAULT_SHAPES.cloud.inner);
    expect(m.shapes.diamond!.inner, "a new outline has none until it says so").toBeUndefined();
    expect(m.shapes.box!.inner).toBeUndefined();
    const r = validate({ shapes: { define: { tag: { corner: 4, inner: [0, 0, 100, 120] } } }, components: [{ id: "a" }] });
    expect(r.ok).toBe(false);
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
    expect(graph.groups!.find((g) => g.id === "g")!.pad).toEqual({ x: 26, y: 12 });
    expect(graph.groups!.find((g) => g.id === "t")!.pad).toBeUndefined();
    const closed = toLayoutGraph(scopeModel(m, m.views[0]!));
    const plain = toLayoutGraph(scopeModel(inline({ groups: [{ id: "c" }], components: [{ id: "b", group: "c" }], views: [{ id: "v", collapse: ["c"] }] }), { id: "v", title: "v", type: "topology", collapse: ["c"] }));
    expect(closed.groups!.find((g) => g.id === "c")!.emptySize!.width - plain.groups!.find((g) => g.id === "c")!.emptySize!.width).toBe(52); // twice the cloud pad
    expect(closed.groups!.find((g) => g.id === "c")!.emptySize!.height - plain.groups!.find((g) => g.id === "c")!.emptySize!.height).toBe(24);
    const r = validate({ kinds: { groups: { x: { shape: "blob" } } }, groups: [{ id: "g", kind: "x" }], components: [{ id: "a" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.toString())).toEqual(['/kinds/groups/x/shape: unknown shape "blob"; known: box, sharp, pill, ellipse, cylinder, hexagon, diamond, parallelogram, document, card, cloud']);
  });
});

describe("a preset shape draws inside the box it declares (issue #31)", () => {
  // Everything downstream trusts the 100x100 box: the label's room, the node's size, the group frame drawn around
  // it. A shape whose outline swells past the box at some aspect ratio breaks the frame, and a node is rarely
  // square: a long label makes a wide, short box.
  const BOXES: [number, number][] = [[100, 100], [160, 48], [400, 48], [640, 56], [80, 220]];
  it("stays inside at every aspect ratio a label can produce", () => {
    for (const [name, shape] of Object.entries(DEFAULT_SHAPES)) {
      if (!shape.path) continue;
      for (const [w, h] of BOXES) {
        const e = pathExtent(scalePath(shape.path, w, h));
        const slack = 0.5; // the scaler rounds to a tenth
        expect(e.minX, `${name} at ${w}x${h} draws left of its box`).toBeGreaterThanOrEqual(-slack);
        expect(e.minY, `${name} at ${w}x${h} draws above its box`).toBeGreaterThanOrEqual(-slack);
        expect(e.maxX, `${name} at ${w}x${h} draws past its right edge`).toBeLessThanOrEqual(w + slack);
        expect(e.maxY, `${name} at ${w}x${h} draws below its bottom edge`).toBeLessThanOrEqual(h + slack);
      }
    }
  });
});

describe("shapes: contents stay inside the outline (R18)", () => {
  it("every preset's clear rectangle is inside its outline, however the node is stretched", () => {
    const out: string[] = [];
    const declared = SHAPE_PRESETS.filter((name) => DEFAULT_SHAPES[name].inner !== undefined);
    expect(declared).toEqual(["ellipse", "hexagon", "diamond", "parallelogram", "cloud"]); // the ones whose edge slants or curves into the box
    for (const name of declared) for (const [w, h] of [[80, 48], [120, 120], [480, 48], [90, 300]] as const) {
      const r = contentRect(DEFAULT_SHAPES[name], w, h);
      if (escaping(insideOutline(DEFAULT_SHAPES[name], w, h), [{ what: name, x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height }]).length) out.push(`${name} at ${w}x${h}`);
    }
    expect(out).toEqual([]);
  });
  it("a node grows until its clear rectangle holds the contents, and never below what the pad gives", () => {
    const m = inline({ kinds: { components: { d: { shape: "diamond" }, b: { shape: "box" } } }, components: [{ id: "d", label: "x".repeat(30), kind: "d" }, { id: "b", label: "x".repeat(30), kind: "b" }] });
    const [d, b] = m.components.map((c) => measureComponent(c, m));
    expect(contentRect(m.shapes.diamond!, d!.width, d!.height).width).toBeGreaterThanOrEqual(b!.width); // what a box draws the same label in
    expect(d!.width).toBeGreaterThan(b!.width + 72); // a long label on a slant: twice the pad is no longer enough
  });
  const LENGTHS = [2, 4, 8, 12, 16, 20, 26, 32, 40];
  /** Text as a box round its anchor: the measured run by a line a little taller than the capitals. */
  const text = (what: string, at: { x: number; y: number }, chars: number, px: number): Box => ({ what, x0: at.x - textWidth(chars, px) / 2, x1: at.x + textWidth(chars, px) / 2, y0: at.y - px * 0.43, y1: at.y + px * 0.43 });
  const badge = (at: { x: number; y: number }): Box => ({ what: "badge", x0: at.x - 20, x1: at.x, y0: at.y - 5, y1: at.y + 5 });

  for (const name of SHAPE_PRESETS) {
    it(`${name}: a component's label, tech line, glyph and badge are inside its outline at every length`, () => {
      const m = inline({ kinds: { components: { plain: { shape: name }, marked: { shape: name, glyph: "database" } } }, components: [{ id: "a", kind: "plain" }] });
      const out: string[] = [];
      for (const variant of ["plain", "tech", "glyph", "replicas", "everything"] as const) for (const n of LENGTHS) {
        const tech = variant === "tech" || variant === "everything" ? "y".repeat(Math.round(n * 1.2)) : undefined;
        const c = { ...m.components[0]!, label: "x".repeat(n), kind: variant === "glyph" || variant === "everything" ? "marked" : "plain", replicas: variant === "replicas" || variant === "everything" ? 3 : 1, ...(tech !== undefined ? { tech } : {}) };
        const b = measureComponent(c, m), at = componentSlots(c, m, b);
        const boxes: Box[] = [text("label", at.label, n, 14)];
        if (at.tech) boxes.push(text("tech", at.tech, tech!.length, 12));
        if (at.glyph) boxes.push({ what: "glyph", x0: at.glyph.x - 2, x1: at.glyph.x + 18, y0: at.glyph.y - 10, y1: at.glyph.y + 10 }); // an icon's 20px slot, the larger of the two
        if (at.badge) boxes.push(badge(at.badge));
        for (const what of escaping(insideOutline(m.shapes[name]!, b.width, b.height), boxes)) out.push(`${variant} ${n}ch: ${what} leaves a ${b.width}x${b.height} ${name}`);
      }
      expect(out).toEqual([]);
    });
    it(`${name}: a closed group's name, expand mark and badge are inside its outline at every length`, () => {
      const m = inline({ kinds: { groups: { k: { shape: name } } }, groups: [{ id: "g", kind: "k" }], components: [{ id: "a", group: "g" }], views: [{ id: "v", collapse: ["g"] }] });
      const closed = scopeModel(m, m.views[0]!).groups[0]!;
      const out: string[] = [];
      for (const replicas of [1, 3]) for (const n of LENGTHS) {
        const g = { ...closed, label: "x".repeat(n), replicas };
        const b = measureClosedGroup(g, m), at = closedGroupSlots(g, m, b);
        const boxes: Box[] = [text("name", at.label, n, 14), { what: "mark", x0: at.mark.x, x1: at.mark.x + 14, y0: at.mark.y, y1: at.mark.y + 14 }];
        if (at.badge) boxes.push(badge(at.badge));
        for (const what of escaping(insideOutline(m.shapes[name]!, b.width, b.height), boxes)) out.push(`×${replicas} ${n}ch: ${what} leaves a ${b.width}x${b.height} ${name}`);
      }
      expect(out).toEqual([]);
    });
  }
});
