import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render, validate } from "../src/index.js";
import { FakeLayoutEngine } from "../src/testing.js";
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
  it("every issue fixture is a case here, so a reported model is never left untested", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    expect(files).toEqual(["31-shape-escapes-group.json"]);
  });
});
