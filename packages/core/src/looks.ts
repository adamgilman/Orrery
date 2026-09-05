import type { LookPreset, LookStyle, StateDef } from "./types.js";

/** The preset looks. A custom look is a LookStyle written by the author; the renderer emits exactly it. Browser-safe. */
export const LOOK_PRESETS: Record<LookPreset, LookStyle> = {
  normal: {},
  warn: { stroke: "#d97706", fill: "#fffbeb", text: "#92400e" },
  alert: { stroke: "#dc2626", fill: "#fef2f2", text: "#991b1b", pulse: true },
  muted: { opacity: 0.45, dash: true },
  highlight: { stroke: "#2563eb", fill: "#eff6ff", text: "#1e3a8a" },
};

export const lookOf = (def: StateDef): LookStyle => (typeof def.look === "string" ? LOOK_PRESETS[def.look] : def.look);

/** CSS colours the model accepts: hex, named, rgb()/hsl(). Anything else is rejected before it can reach a stylesheet. */
export const CSS_COLOR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|(rgb|hsl)a?\([\d\s.,%/]+\))$/;
