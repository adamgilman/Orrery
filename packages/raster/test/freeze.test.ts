import { describe, expect, it } from "vitest";
import { FLOW_PERIOD, flowDuration } from "@orrery/core";
import { freezeFrame } from "../src/index.js";

const flow = (key: string, style: string, load = 0.5) => `<path class="flow" data-flow="${key}" data-load="${load}" d="M0 0 L100 0" style="${style}"/>`;
const svg = (...paths: string[]) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 10">\n${paths.join("\n")}\n</svg>\n`;

describe("freezeFrame", () => {
  it("replaces the animation with the exact dash offset for time t", () => {
    const d = flowDuration(0.5);
    const out = freezeFrame(svg(flow("a->b", `stroke-width:3;animation-duration:${d}s`)), (d * 1000) / 4);
    expect(out).toContain("animation:none");
    expect(out).toContain(`stroke-dashoffset:-${FLOW_PERIOD / 4}`);
    expect(out).not.toContain("animation-duration");
  });
  it("does not wrap: t equal to the duration gives a full period shift, so periodicity is checked, not assumed", () => {
    const d = flowDuration(1);
    const out = freezeFrame(svg(flow("a->b", `stroke-width:4.5;animation-duration:${d}s`)), d * 1000);
    expect(out).toContain(`stroke-dashoffset:-${FLOW_PERIOD}`);
  });
  it("leaves zero-load flows untouched", () => {
    const s = svg(flow("a->b", "stroke-width:1.5;animation:none;opacity:0", 0));
    expect(freezeFrame(s, 123)).toBe(s);
  });
  it("preserves everything else byte for byte", () => {
    const s = svg(`<rect width="10" height="10"/>`, flow("x->y", "stroke-width:3;animation-duration:1s"));
    const out = freezeFrame(s, 0);
    expect(out.replace(/style="[^"]*"/, "")).toBe(s.replace(/style="[^"]*"/, ""));
  });
});
