/** Normalised diagram model (M0 subset). All defaults applied, all references resolved. */
export type Direction = "right" | "down";

export interface DiagramNode {
  id: string;
  label: string;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
  /** 0..1, drives flow animation. */
  load: number;
}

export interface Diagram {
  title?: string;
  direction: Direction;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}
