import { describe, expect, it } from "vitest";
import { FLOW_PERIOD, flowDuration } from "@orrery-diagrams/core";
import { freezeFrame, freezeTracks } from "../src/index.js";

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

describe("freezeTracks: path data (R14)", () => {
  it("interpolates a shaped frame's d between scenes and writes it as an attribute", () => {
    const svg = `<svg><style>@keyframes orrery-size-g{0%{d:path("M0 0H100L120 24 100 48H0Z")}50%{d:path("M0 0H200L220 48 200 96H0Z")}100%{d:path("M0 0H200L220 48 200 96H0Z")}}</style><path class="group-box" data-shape="x" d="M0 0H100L120 24 100 48H0Z" style="animation:orrery-size-g 10s linear infinite"/></svg>`;
    expect(freezeTracks(svg, 2500)).toContain('<path class="group-box" data-shape="x" d="M0 0H150L170 36 150 72H0Z" style=""');
    expect(freezeTracks(svg, 7000)).toContain('d="M0 0H200L220 48 200 96H0Z"');
  });
});
