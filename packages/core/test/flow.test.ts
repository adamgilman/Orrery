import { describe, expect, it } from "vitest";
import { FLOW_DASH, FLOW_PERIOD, flowDuration, flowStyle } from "../src/index.js";
import * as flow from "../src/flow.js";

describe("flow animation constants", () => {
  it("period equals the dash pattern length so one cycle is seamless", () => {
    expect(FLOW_PERIOD).toBe(FLOW_DASH.reduce((a, b) => a + b, 0));
  });
  it("duration falls monotonically with load and is what the style emits", () => {
    expect(flowDuration(1)).toBeLessThan(flowDuration(0.5));
    expect(flowDuration(0.5)).toBeLessThan(flowDuration(0.1));
    expect(flowStyle(0.4)).toContain(`animation-duration:${flowDuration(0.4)}s`);
  });
  it("lives in a browser-safe module (no node imports) so the runtime can bundle it", () => {
    expect(flow.flowStyle).toBe(flowStyle);
    expect(flow.PULSE_PERIOD).toBeGreaterThan(0);
  });
});
