/**
 * The public API of @orrery-diagrams/core, and the whole of what semver covers: the model's types, validation,
 * a moment of the model, rendering, packs, the glyph check, and the contract a layout engine implements.
 * Everything else is reachable but not promised: `@orrery-diagrams/core/internal` (and `/internal/<module>`) for
 * the renderer's parts, `@orrery-diagrams/core/testing` for the fake layout engine. `packages/core/test/api.test.ts`
 * pins this list, so growing it is a decision, not an accident.
 */
export type * from "./types.js";
export { validate, schema, ValidationError, ValidationWarning, type ValidationResult, type ValidateOptions } from "./validate.js";
export { declare, ModelError, type Declaration } from "./declare.js";
export { render, renderDocument, renderExport, type RenderOptions, type DocumentOptions } from "./render.js";
export { loadPack, packNames, packProblem, installHint, PROVIDER_PACKS, type Pack } from "./packs.js";
export { sanitizeGlyph, type GlyphCheck } from "./glyph.js";
export type { LayoutEngine, LayoutGraph, LayoutResult, Point, Box } from "./layout.js";
