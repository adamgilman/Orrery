import type { ConnectionKindDef, LinePreset, LineStyle, LookPreset, LookStyle, StateDef } from "./types.js";

/** The preset looks. A custom look is a LookStyle written by the author; the renderer emits exactly it. Browser-safe. */
export const LOOK_PRESETS: Record<LookPreset, LookStyle> = {
  normal: {},
  warn: { stroke: "#d97706", fill: "#fffbeb", text: "#92400e" },
  alert: { stroke: "#dc2626", fill: "#fef2f2", text: "#991b1b", pulse: true },
  muted: { opacity: 0.45, dash: true },
  highlight: { stroke: "#2563eb", fill: "#eff6ff", text: "#1e3a8a" },
};

export const lookOf = (def: StateDef): LookStyle => (typeof def.look === "string" ? LOOK_PRESETS[def.look] : def.look);

/** The preset lines. The default connection kinds bind to these; a custom line is a LineStyle the renderer emits exactly. */
export const LINE_STYLES: Record<LinePreset, LineStyle> = {
  solid: {},
  dashed: { dash: "6 5" },
  dotted: { dash: "2 4" },
  heavy: { width: 3 },
};
export const lineOf = (def: ConnectionKindDef): LineStyle => (typeof def.line === "string" ? LINE_STYLES[def.line] : def.line);

/** CSS colours the model accepts: hex, named, rgb()/hsl(). Anything else is rejected before it can reach a stylesheet. */
export const CSS_COLOR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|(rgb|hsl)a?\([\d\s.,%/]+\))$/;
