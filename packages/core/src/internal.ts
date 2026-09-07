/**
 * The parts behind the public API: what the renderer, the runtime, the raster and the tools are built from.
 * Reachable as `@orrery-diagrams/core/internal` (this barrel) or `@orrery-diagrams/core/internal/<module>`, and
 * not promised by semver: a module here may change between any two versions. The public API is `./index.ts`.
 */
export * from "./defaults.js";
export { applySet, stopFlows } from "./declare.js";
export { GROUP_PADDING, EMPTY_GROUP, emptyGroups } from "./layout.js";
export * from "./measure.js";
export { renderView, renderSvg, trimEnd } from "./render.js";
export * from "./view.js";
export * from "./flow.js";
export * from "./looks.js";
export * from "./shapes.js";
export * from "./sequence.js";
