import type { ComponentKindDef, ConnectionKindDef, GroupKindDef, StateDef } from "./types.js";

/** The default vocabulary. Authors may override, extend or replace all of it; nothing in the renderer names these. */
export const DEFAULT_STATES: Record<string, Omit<StateDef, "name">> = {
  on: { look: "normal", flows: "keep", description: "Working normally" },
  degraded: { look: "warn", flows: "keep", description: "Working with reduced redundancy or capacity" },
  failed: { look: "alert", flows: "stop", description: "Broken" },
  off: { look: "muted", flows: "stop", description: "Deliberately switched off" },
};
export const DEFAULT_STATE = "on";
/** A state the author defines without saying otherwise. */
export const NEW_STATE_DEFAULTS: Omit<StateDef, "name"> = { look: "normal", flows: "keep" };

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
export const LINE_PRESETS = ["solid", "dashed", "dotted", "heavy"] as const;
export const DEFAULT_CONNECTION_KINDS: Record<string, ConnectionKindDef> = {
  sync: { line: "solid", description: "A synchronous call" },
  async: { line: "dashed", description: "A message or event" },
  replication: { line: "dotted", description: "Data copied between stores" },
  dataflow: { line: "heavy", description: "A bulk stream of data" },
};
export const DEFAULT_GROUP_KINDS: Record<string, GroupKindDef> = {
  tier: { frame: "tier", description: "A tier or layer" },
  region: { frame: "region", description: "A region" },
  zone: { frame: "zone", description: "An availability zone" },
  cluster: { frame: "cluster", description: "A cluster" },
  boundary: { frame: "boundary", description: "A trust or ownership boundary" },
};
