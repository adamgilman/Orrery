/**
 * The normalised model. All defaults applied, every reference checked, every state and kind resolved.
 * Vocabulary follows docs/MODEL.md: components, connections, groups, needs, states, kinds, views, scenarios.
 * Layout and rendering internals still speak of nodes and edges; that boundary is `toLayoutGraph`.
 */
export type Direction = "right" | "down";
export type ViewType = "topology";
export type ConnectionKind = "sync" | "async" | "replication" | "dataflow";

export type LookPreset = "normal" | "warn" | "alert" | "muted" | "highlight";
export interface LookStyle { stroke?: string; fill?: string; text?: string; dash?: boolean; pulse?: boolean; opacity?: number }

export interface StateDef {
  name: string;
  look: LookPreset | LookStyle;
  rank: number;
  available: boolean;
  flows: "keep" | "stop";
  cascade: "none" | "children";
  description?: string;
}

export interface States {
  /** State of anything that declares none; what `restore` returns to. */
  default: string;
  needs: { unmet: string; reduced: string };
  define: Record<string, StateDef>;
}

export interface ComponentKindDef { glyph?: string; box?: { dash?: boolean; fill?: string; stroke?: string }; description?: string }
export interface GroupKindDef { frame: "tier" | "region" | "zone" | "cluster" | "boundary" | { stroke?: string; fill?: string; fillOpacity?: number; dash?: boolean; dotted?: boolean }; description?: string }
export interface Kinds { components: Record<string, ComponentKindDef>; groups: Record<string, GroupKindDef> }

export interface Need {
  /** Alternatives in order of preference; entity ids (components or groups). */
  any: string[];
  min: number;
  unmet: string;
  reduced: string;
}

export interface Component {
  id: string;
  label: string;
  kind: string;
  group?: string;
  /** Declared state, or after propagation the effective state. */
  state: string;
  /** Set by propagation when the state was derived rather than declared. */
  reason?: string;
  needs: Need[];
  replicas: number;
  tech?: string;
  description?: string;
  meta?: Record<string, unknown>;
  /** Set by view scoping: an outside entity drawn at the edge of a scoped view. Drawn from this flag, never from `kind`. */
  ghost?: true;
}

export interface Group {
  id: string;
  label: string;
  kind: string;
  parent?: string;
  state: string;
  reason?: string;
  description?: string;
  meta?: Record<string, unknown>;
  /** Set by view scoping when the group is drawn closed: how many components are hidden inside. */
  collapsed?: number;
}

export interface Connection {
  /** Internal key: the id if given, else "<from>-><to>". Used as the DOM handle; never authored. */
  key: string;
  id?: string;
  from: string;
  to: string;
  kind: ConnectionKind;
  label?: string;
  /** Declared load, or after propagation the effective load. */
  load: number;
  bidirectional: boolean;
  meta?: Record<string, unknown>;
  /** Set by propagation: this connection satisfies a need of `from` (or `to`). Drawn darker. */
  need?: true;
}

export interface Play { scenario: string; seconds: number }

export interface View {
  id: string;
  type: ViewType;
  direction: Direction;
  title?: string;
  scope?: string;
  only?: string[];
  /** Cycle this scenario's steps on a timer: as CSS layers in the file, and in the runtime until the reader interacts. */
  play?: Play;
  /** Groups drawn closed in this view: one box, members hidden, connections re-attached. */
  collapse?: string[];
}

export interface ScenarioStep {
  note?: string;
  /** state name → entity ids */
  set: Record<string, string[]>;
  restore: string[];
  /** connection key → load */
  load: Record<string, number>;
}

export interface Scenario { id: string; label: string; steps: ScenarioStep[] }

export interface Model {
  title?: string;
  direction: Direction;
  states: States;
  kinds: Kinds;
  components: Component[];
  connections: Connection[];
  groups: Group[];
  /** Never empty: a default topology view is synthesised when the file has none. */
  views: View[];
  scenarios: Scenario[];
  /** Views shown in turn on a timer: CSS crossfade in the file, the morph in the runtime. */
  tour?: Tour;
}

export interface Tour { views: string[]; seconds: number }

/** Anything with an id and a state: a component or a group. */
export type Entity = Component | Group;
