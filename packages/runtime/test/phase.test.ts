import { describe, expect, it } from "vitest";
import { continuedDelay } from "../src/browser/phase.js";

describe("phase continuity", () => {
  it("returns a negative delay that resumes the new animation at the old phase", () => {
    // 40% through a 2s cycle, switching to a 1s cycle → start 0.4s in
    expect(continuedDelay(800, 2000, 1000)).toBeCloseTo(-400, 6);
    expect(continuedDelay(2800, 2000, 1000)).toBeCloseTo(-400, 6); // wraps
    expect(continuedDelay(null, 2000, 1000)).toBe(0);
  });
});
