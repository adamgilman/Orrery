/** Animation constants and formulas. Browser-safe (no node imports): the runtime bundles this module. */

const num = (n: number) => String(Math.round(n * 10) / 10);

/** Dash pattern of the flow overlay, in user units: [dash, gap]. */
export const FLOW_DASH: readonly [number, number] = [6, 10];
/** One animation cycle shifts the dashes by exactly one pattern length, so looping is seamless. */
export const FLOW_PERIOD = FLOW_DASH[0] + FLOW_DASH[1];

/** Seconds per cycle for a given load. Pure, so frame tooling can freeze the animation at any t. */
export function flowDuration(load: number): number {
  return Math.round((0.5 + (1 - load) * 2.5) * 10) / 10;
}

function flowWidth(load: number): number {
  return 1.5 + load * 3;
}

/** Flow animation is a pure function of load: faster and thicker as load rises, off at zero. */
export function flowStyle(load: number): string {
  const width = flowWidth(load);
  if (load <= 0) return `stroke-width:${num(width)};animation:none;opacity:0`;
  return `stroke-width:${num(width)};animation-duration:${num(flowDuration(load))}s`;
}

/** Seconds per pulse of the outline of an entity whose look pulses. Linear triangle wave 1 → 0.4 → 1, so frames can freeze it exactly. */
export const PULSE_PERIOD = 1.2;
export const PULSE_MIN_OPACITY = 0.4;
