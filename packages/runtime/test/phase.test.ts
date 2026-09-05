import { describe, expect, it } from "vitest";
import { phaseOf } from "../src/browser/phase.js";

describe("phase continuity", () => {
  it("gives the fraction through the old cycle so the new animation can resume there", () => {
    expect(phaseOf(800, 2000)).toBeCloseTo(0.4, 6);
    expect(phaseOf(2800, 2000)).toBeCloseTo(0.4, 6); // wraps
    expect(phaseOf(null, 2000)).toBe(0);
    expect(phaseOf(500, 0)).toBe(0);
  });
});
