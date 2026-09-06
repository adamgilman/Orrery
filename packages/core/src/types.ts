/**
 * The normalised model. All defaults applied, every reference checked, every state and kind resolved.
 * Vocabulary follows docs/MODEL.md: components, connections, groups, states, kinds, views, scenarios.
 * Layout and rendering internals still speak of nodes and edges; that boundary is `toLayoutGraph`.
 */
export type Direction = "right" | "down";
export type ViewType = "topology";

export type LookPreset = "normal" | "warn" | "alert" | "muted" | "highlight";
export interface LookStyle { stroke?: string; fill?: string; text?: string; dash?: boolean; pulse?: boolean; opacity?: number }

/** How a state is drawn. `flows: stop` is a drawing rule: connections touching an entity in this state show no flow. */
export interface StateDef {
  name: string;
  look: LookPreset | LookStyle;
  flows: "keep" | "stop";
  description?: string;
}

export interface States {
  /** State of anything that declares none; what `restore` returns to. */
  default: string;
  define: Record<string, StateDef>;
}

export interface ComponentKindDef { glyph?: string; box?: { dash?: boolean; fill?: string; stroke?: string }; description?: string }
export interface GroupKindDef { frame: "tier" | "region" | "zone" | "cluster" | "boundary" | { stroke?: string; fill?: string; fillOpacity?: number; dash?: boolean; dotted?: boolean }; description?: string }
export type LinePreset = "solid" | "dashed" | "dotted" | "heavy";
/** How a connection kind is drawn: line colour and width, an SVG dash pattern, and the colour of the animated traffic. */
export interface LineStyle { stroke?: string; width?: number; dash?: string; flow?: string }
export interface ConnectionKindDef { line: LinePreset | LineStyle; description?: string }
export interface Kinds { components: Record<string, ComponentKindDef>; groups: Record<string, GroupKindDef>; connections: Record<string, ConnectionKindDef> }

export interface Component {
  id: string;
  label: string;
  kind: string;
  group?: string;
  /** The state the author gave it: base model, then scenario steps, then a what-if. */
  state: string;
  /** The author's explanation of the state, from a scenario step's `set`. */
  reason?: string;
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
  /** A name from `kinds.connections`; picks the line style. */
  kind: string;
  label?: string;
  /** The load the author gave it: base model, then scenario steps. */
  load: number;
  bidirectional: boolean;
  meta?: Record<string, unknown>;
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
  /** entity id → the author's reason for its state at this step */
  reasons: Record<string, string>;
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
  /** The files `orrery export` writes. Never undefined after validation. */
  exports: Export[];
}

/**
 * One file the model produces (4.9): a view at a moment, a scenario playing, or the tour. `open` lists the closed
 * groups drawn open (in declaration order); `zoom` is the entity the picture is cropped to.
 */
export interface Export { id: string; view: string; open?: string[]; zoom?: string; scenario?: string; step?: number; set?: Record<string, string[]>; reasons?: Record<string, string>; play?: Play; tour?: true }

/**
 * One moment of a tour: a view, the closed groups drawn open, what the camera closes on, optionally a point in a
 * scenario, states set for the scene, a caption and its own duration. Opening and zooming are separate actions.
 */
export interface Scene { view: string; open?: string[]; zoom?: string; scenario?: string; step?: number; set?: Record<string, string[]>; reasons?: Record<string, string>; note?: string; seconds: number }
export interface Tour { seconds: number; scenes: Scene[] }

