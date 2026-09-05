import { describe, expect, it } from "vitest";
import { fitView, transformOf, zoomToBox, type Camera } from "../src/browser/camera.js";

describe("camera", () => {
  it("fits a view inside the screen minus the panel, centred, never above max zoom", () => {
    const c = fitView({ width: 1000, height: 500 }, { width: 1600, height: 900 }, { left: 280, margin: 20 });
    expect(c.k).toBeCloseTo(Math.min((1600 - 280 - 40) / 1000, (900 - 40) / 500), 5);
    // centred in the remaining area
    expect(c.tx).toBeCloseTo(280 + 20 + ((1600 - 280 - 40) - 1000 * c.k) / 2, 5);
    expect(c.ty).toBeCloseTo(20 + ((900 - 40) - 500 * c.k) / 2, 5);
    const small = fitView({ width: 100, height: 50 }, { width: 1600, height: 900 }, { left: 280, margin: 20, maxZoom: 1.5 });
    expect(small.k).toBe(1.5);
  });
  it("zooms to a box with padding, capped, and keeps it inside the free area", () => {
    const c = zoomToBox({ x: 100, y: 100, width: 200, height: 50 }, { width: 1600, height: 900 }, { left: 280, margin: 20, maxZoom: 2, pad: 40 });
    expect(c.k).toBe(2);
    const cx = c.tx + (100 + 100) * c.k, cy = c.ty + (100 + 25) * c.k;
    expect(cx).toBeCloseTo(280 + 20 + (1600 - 280 - 40) / 2, 5);
    expect(cy).toBeCloseTo(20 + (900 - 40) / 2, 5);
  });
  it("formats a transform attribute", () => {
    const c: Camera = { k: 2, tx: 10.123, ty: -5 };
    expect(transformOf(c)).toBe("translate(10.123 -5) scale(2)");
  });
});
