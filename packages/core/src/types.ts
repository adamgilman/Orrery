/** Normalised diagram model. All defaults applied, all references checked. The top level is the model; views describe drawings of it. */
export type Direction = "right" | "down";
export type NodeKind = "service" | "database" | "queue" | "cache" | "gateway" | "client" | "storage" | "function" | "external";
export type GroupKind = "tier" | "region" | "zone" | "cluster" | "boundary";
export type EdgeKind = "sync" | "async" | "replication" | "dataflow";
export type ViewType = "topology";

export interface DiagramNode {
  id: string;
  label: string;
  kind: NodeKind;
  /** Enclosing group id, if any. */
  group?: string;
}

export interface DiagramGroup {
  id: string;
  label: string;
  kind: GroupKind;
  parent?: string;
}

export interface DiagramEdge {
  /** Unique; defaults to "<from>-><to>". */
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  label?: string;
  /** 0..1, drives flow animation. */
  load: number;
}

export interface DiagramView {
  id: string;
  type: ViewType;
  direction: Direction;
  title?: string;
  /** Group id to drill into; absent means everything. */
  scope?: string;
}

export interface Diagram {
  title?: string;
  direction: Direction;
  groups: DiagramGroup[];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /** Never empty: a default topology view is synthesised when the file has none. */
  views: DiagramView[];
}
