import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render, validate } from "../src/index.js";
import { FakeLayoutEngine } from "../src/testing.js";
import { textWidth } from "../src/internal.js";
import { escaping, insideOutline } from "./outline.js";
import { pathExtent } from "./pathExtent.js";

/**
 * A reported bug, replicated. Each case here is the model from an issue, unchanged, and the assertion is the
 * symptom its reporter saw. A test that only covers the cause can pass while the reported picture is still wrong,
 * so the fix is not done until the reporter's own file draws correctly. `fixtures/issues/<n>-<slug>.json`.
 */
const dir = join(import.meta.dirname, "../../../fixtures/issues");
const modelOf = (file: string) => {
  const r = validate(JSON.parse(readFileSync(join(dir, file), "utf8")));
  if (!r.ok) throw new Error(`${file}: ${r.errors.map((e) => e.toString()).join(", ")}`);
  return r.model;
};

/** Every drawn node, as its outline's extent in the picture's coordinates. */
function drawnNodes(svg: string): { id: string; minX: number; minY: number; maxX: number; maxY: number }[] {
  return [...svg.matchAll(/<g class="node[^"]*" data-node="([^"]+)"[^>]*transform="translate\(([\d.-]+) ([\d.-]+)\)">\s*<(?:path|rect) class="node-box"([^>]*)>/g)].map((m) => {
    const [, id, tx, ty, attrs] = m;
    const d = attrs!.match(/\sd="([^"]+)"/)?.[1];
    const box = d
      ? pathExtent(d)
      : { minX: 0, minY: 0, maxX: Number(attrs!.match(/\swidth="([\d.]+)"/)![1]), maxY: Number(attrs!.match(/\sheight="([\d.]+)"/)![1]) };
    return { id: id!, minX: box.minX + Number(tx), minY: box.minY + Number(ty), maxX: box.maxX + Number(tx), maxY: box.maxY + Number(ty) };
  });
}

describe("issues, replicated", () => {
  it("#31: a cloud-shaped node with a long label stays inside its group's frame", async () => {
    const svg = await render(modelOf("31-shape-escapes-group.json"), new FakeLayoutEngine());
    const frame = svg.match(/data-group="data-plane"[^>]*data-bbox="([\d.-]+) ([\d.-]+) ([\d.]+) ([\d.]+)"/);
    expect(frame, "the group is not drawn").not.toBeNull();
    const [fx, fy, fw, fh] = frame!.slice(1).map(Number) as [number, number, number, number];
    const nodes = drawnNodes(svg);
    expect(nodes.map((n) => n.id).sort()).toEqual(["embedded-cache", "site"]);
    for (const n of nodes) {
      // the reported symptom: the cloud's lobes drew out through the right and the bottom of the boundary box
      expect(n.minX, `${n.id} draws left of the frame`).toBeGreaterThanOrEqual(fx);
      expect(n.minY, `${n.id} draws above the frame`).toBeGreaterThanOrEqual(fy);
      expect(n.maxX, `${n.id} draws out through the right of the frame`).toBeLessThanOrEqual(fx + fw);
      expect(n.maxY, `${n.id} draws out through the bottom of the frame`).toBeLessThanOrEqual(fy + fh);
    }
  });
  it("#51: on a cloud, a diamond and a parallelogram the label, tech line and badge are inside the node's own outline", async () => {
    const model = modelOf("51-contents-cross-outline.json");
    const svg = await render(model, new FakeLayoutEngine());
    // each node's markup runs to the next node's; nothing after the last one carries a node class
    const nodes = svg.split(/<g class="node(?=[ "])/).slice(1).map((markup) => ({ id: markup.match(/data-node="([^"]+)"/)![1]!, markup }));
    expect(nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c", "d", "e", "f", "h"]);
    const out: string[] = [];
    for (const n of nodes) {
      const d = n.markup.match(/<path class="node-box" d="([^"]+)"/)![1]!;
      const box = pathExtent(d);
      const isIn = insideOutline({ path: d }, 100, 100); // already at its drawn size: scaling by 100 over 100 leaves it be
      const texts = [...n.markup.matchAll(/<text class="(node-label|node-tech|badge)" x="([\d.]+)" y="([\d.]+)">([^<]*)</g)].map(([, cls, x, y, t]) => {
        const px = cls === "node-label" ? 14 : 12, w = textWidth(t!.length, px), cx = Number(x), cy = Number(y);
        return cls === "badge" ? { what: `${n.id} badge`, x0: cx - w, x1: cx, y0: cy - 5, y1: cy + 5 } : { what: `${n.id} ${cls}`, x0: cx - w / 2, x1: cx + w / 2, y0: cy - px * 0.43, y1: cy + px * 0.43 };
      });
      expect(texts.length, `${n.id} draws no label`).toBeGreaterThan(0);
      expect(box.maxX).toBeGreaterThan(0);
      // the reported symptom: the outline ran through the text, and the badge sat outside it
      out.push(...escaping(isIn, texts));
    }
    expect(out).toEqual([]);
  });
  it("every issue fixture is a case here, so a reported model is never left untested", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    expect(files).toEqual(["31-shape-escapes-group.json", "51-contents-cross-outline.json"]);
  });
});
