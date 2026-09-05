import type { ComponentKindDef, GroupKindDef, StateDef } from "./types.js";

/** The default vocabulary. Authors may override, extend or replace all of it; nothing in the engine names these. */
export const DEFAULT_STATES: Record<string, Omit<StateDef, "name">> = {
  on: { look: "normal", rank: 0, available: true, flows: "keep", cascade: "none", description: "Working normally" },
  degraded: { look: "warn", rank: 1, available: true, flows: "keep", cascade: "none", description: "Working with reduced redundancy or capacity" },
  failed: { look: "alert", rank: 2, available: false, flows: "stop", cascade: "none", description: "Broken" },
  off: { look: "muted", rank: 2, available: false, flows: "stop", cascade: "children", description: "Deliberately switched off" },
};
export const DEFAULT_STATE = "on";
/** Mechanics of a state the author defines without saying otherwise. */
export const NEW_STATE_DEFAULTS: Omit<StateDef, "name"> = { look: "normal", rank: 1, available: true, flows: "keep", cascade: "none" };
export const DEFAULT_NEED_OUTCOMES = { unmet: "failed", reduced: "degraded" };

/** Preset glyph names a kind may reuse. `service` and `external` have no glyph and are not in this list. */
export const GLYPH_PRESETS = ["database", "queue", "cache", "gateway", "client", "storage", "function"] as const;
export const DEFAULT_COMPONENT_KINDS: Record<string, ComponentKindDef> = {
  service: { description: "A running service" },
  database: { glyph: "database", description: "A database" },
  queue: { glyph: "queue", description: "A message queue or stream" },
  cache: { glyph: "cache", description: "A cache" },
  gateway: { glyph: "gateway", description: "An entry point: load balancer, API gateway, CDN" },
  client: { glyph: "client", description: "A person, browser or device" },
  storage: { glyph: "storage", description: "Object or file storage" },
  function: { glyph: "function", description: "A function or job" },
  external: { box: { dash: true, fill: "#f8fafc" }, description: "A system outside your control" },
};
export const FRAME_PRESETS = ["tier", "region", "zone", "cluster", "boundary"] as const;
export const DEFAULT_GROUP_KINDS: Record<string, GroupKindDef> = {
  tier: { frame: "tier", description: "A tier or layer" },
  region: { frame: "region", description: "A region" },
  zone: { frame: "zone", description: "An availability zone" },
  cluster: { frame: "cluster", description: "A cluster" },
  boundary: { frame: "boundary", description: "A trust or ownership boundary" },
};
