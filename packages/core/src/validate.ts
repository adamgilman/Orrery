import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv, type ErrorObject } from "ajv";
import type { Diagram, Direction, EdgeKind, GroupKind, NodeKind, NodeState, ViewType } from "./types.js";

export class ValidationError {
  constructor(
    /** JSON pointer (RFC 6901) to the offending value; "" for the document root. */
    public readonly pointer: string,
    public readonly message: string,
  ) {}
  toString(): string {
    return `${this.pointer}: ${this.message}`;
  }
}

export type ValidationResult = { ok: true; diagram: Diagram } | { ok: false; errors: ValidationError[] };

export const schema: object = JSON.parse(readFileSync(join(import.meta.dirname, "../schema/v1.json"), "utf8"));

const ajv = new Ajv({ allErrors: true, useDefaults: true, strict: true });
const checkSchema = ajv.compile(schema);

const article = (t: string) => (/^[aeiou]/.test(t) ? `an ${t}` : `a ${t}`);

function describe(e: ErrorObject): ValidationError {
  const p = e.params as Record<string, unknown>;
  switch (e.keyword) {
    case "additionalProperties":
      return new ValidationError(e.instancePath, `unknown property "${String(p.additionalProperty)}"`);
    case "required":
      return new ValidationError(e.instancePath, `missing required property "${String(p.missingProperty)}"`);
    case "enum":
      return new ValidationError(e.instancePath, `must be one of: ${(p.allowedValues as unknown[]).join(", ")}`);
    case "type":
      return new ValidationError(e.instancePath, `must be ${article(String(p.type))}`);
    default:
      return new ValidationError(e.instancePath, e.message ?? e.keyword);
  }
}

/** Semantic checks that JSON Schema cannot express. Runs only on schema-valid, normalised input. */
function checkSemantics(d: Diagram, explicitEdgeIds: boolean[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const err = (pointer: string, message: string) => errors.push(new ValidationError(pointer, message));

  const groupIds = new Set<string>();
  d.groups.forEach((g, i) => {
    if (groupIds.has(g.id)) err(`/groups/${i}/id`, `duplicate group id "${g.id}"`);
    groupIds.add(g.id);
  });
  const nodeIds = new Set<string>();
  d.nodes.forEach((n, i) => {
    if (nodeIds.has(n.id)) err(`/nodes/${i}/id`, `duplicate node id "${n.id}"`);
    else if (groupIds.has(n.id)) err(`/nodes/${i}/id`, `id "${n.id}" is already used by a group`);
    nodeIds.add(n.id);
    if (n.group !== undefined && !groupIds.has(n.group)) err(`/nodes/${i}/group`, `unknown group "${n.group}"`);
  });

  // Parent references and cycles. Every group on a cycle is reported so the author sees the whole loop.
  const parentOf = new Map(d.groups.map((g) => [g.id, g.parent] as const));
  d.groups.forEach((g, i) => {
    if (g.parent === undefined) return;
    if (!groupIds.has(g.parent)) return err(`/groups/${i}/parent`, `unknown group "${g.parent}"`);
    const seen = new Set<string>([g.id]);
    for (let cur: string | undefined = g.parent; cur !== undefined; cur = parentOf.get(cur)) {
      if (cur === g.id) return err(`/groups/${i}/parent`, `group cycle through "${g.id}"`);
      if (seen.has(cur)) return; // joins a cycle it is not on; that cycle is reported by its own members
      seen.add(cur);
    }
  });

  const edgeIds = new Set<string>();
  d.edges.forEach((e, i) => {
    if (!nodeIds.has(e.from)) err(`/edges/${i}/from`, `unknown node "${e.from}"`);
    if (!nodeIds.has(e.to)) err(`/edges/${i}/to`, `unknown node "${e.to}"`);
    if (e.from === e.to && nodeIds.has(e.from)) err(`/edges/${i}`, `self-referencing edge "${e.from}"`);
    if (e.dependsOn && e.fallback) err(`/edges/${i}`, "an edge cannot be both dependsOn and fallback");
    if (edgeIds.has(e.id)) {
      const hint = explicitEdgeIds[i] ? "" : "; give one of them an explicit id";
      err(explicitEdgeIds[i] ? `/edges/${i}/id` : `/edges/${i}`, `duplicate edge id "${e.id}"${hint}`);
    }
    edgeIds.add(e.id);
  });

  const scenarioIds = new Set<string>();
  d.scenarios.forEach((sc, i) => {
    if (scenarioIds.has(sc.id)) err(`/scenarios/${i}/id`, `duplicate scenario id "${sc.id}"`);
    scenarioIds.add(sc.id);
    sc.steps.forEach((st, j) => {
      const base = `/scenarios/${i}/steps/${j}`;
      if (Object.keys(st.nodes).length + Object.keys(st.edges).length === 0) err(base, "step changes nothing");
      for (const id of Object.keys(st.nodes)) if (!nodeIds.has(id)) err(`${base}/nodes/${id}`, `unknown node "${id}"`);
      for (const id of Object.keys(st.edges)) if (!edgeIds.has(id)) err(`${base}/edges/${id}`, `unknown edge "${id}"`);
    });
  });

  // Fallback coverage: explicit fallbackFor must be a dependsOn edge from the same source; otherwise default to the
  // source's only dependsOn edge, or complain so the author disambiguates.
  const byId = new Map(d.edges.map((e) => [e.id, e] as const));
  d.edges.forEach((e, i) => {
    if (!e.fallback) return;
    if (e.fallbackFor !== undefined) {
      const target = byId.get(e.fallbackFor);
      if (!target) return err(`/edges/${i}/fallbackFor`, `unknown edge "${e.fallbackFor}"`);
      if (target.from !== e.from) return err(`/edges/${i}/fallbackFor`, `"${e.fallbackFor}" does not start at "${e.from}"`);
      if (!target.dependsOn) return err(`/edges/${i}/fallbackFor`, `"${e.fallbackFor}" is not a dependsOn edge`);
      return;
    }
    const deps = d.edges.filter((x) => x.from === e.from && x.dependsOn);
    if (deps.length === 1) e.fallbackFor = deps[0]!.id;
    else err(`/edges/${i}`, `fallback edge needs fallbackFor: "${e.from}" has ${deps.length} dependsOn edges${deps.length ? ` (${deps.map((x) => x.id).join(", ")})` : ""}`);
  });

  const viewIds = new Set<string>();
  d.views.forEach((v, i) => {
    if (viewIds.has(v.id)) err(`/views/${i}/id`, `duplicate view id "${v.id}"`);
    viewIds.add(v.id);
    if (v.scope !== undefined && !groupIds.has(v.scope)) err(`/views/${i}/scope`, `unknown group "${v.scope}"`);
  });
  return errors;
}

interface RawDiagram {
  $schema?: string;
  title?: string;
  direction: Direction;
  groups: { id: string; label?: string; kind: GroupKind; parent?: string }[];
  nodes: { id: string; label?: string; kind: NodeKind; group?: string; state: NodeState }[];
  edges: { id?: string; from: string; to: string; kind: EdgeKind; label?: string; load?: number; dependsOn: boolean | "soft"; fallback: boolean; fallbackFor?: string }[];
  views?: { id: string; title?: string; type: ViewType; direction?: Direction; scope?: string }[];
  scenarios: { id: string; label?: string; steps: { note?: string; nodes?: Record<string, { state: NodeState }>; edges?: Record<string, { load: number }> }[] }[];
}

const opt = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
  (value !== undefined ? ({ [key]: value } as { [P in K]: V }) : {});

/** Validate an untrusted JSON value and return a normalised Diagram or a list of pointer-addressed errors. */
export function validate(input: unknown): ValidationResult {
  const data: unknown = structuredClone(input); // useDefaults mutates; never touch the caller's object
  if (!checkSchema(data)) {
    const errors = (checkSchema.errors ?? []).map(describe);
    return { ok: false, errors: dedupe(errors) };
  }
  const raw = data as RawDiagram;
  const diagram: Diagram = {
    ...opt("title", raw.title),
    direction: raw.direction,
    groups: raw.groups.map((g) => ({ id: g.id, label: g.label ?? g.id, kind: g.kind, ...opt("parent", g.parent) })),
    nodes: raw.nodes.map((n) => ({ id: n.id, label: n.label ?? n.id, kind: n.kind, state: n.state, ...opt("group", n.group) })),
    edges: raw.edges.map((e) => ({
      id: e.id ?? `${e.from}->${e.to}`, from: e.from, to: e.to, kind: e.kind, load: e.load ?? (e.fallback ? 0 : 0.5),
      dependsOn: e.dependsOn, fallback: e.fallback, ...opt("label", e.label), ...opt("fallbackFor", e.fallbackFor),
    })),
    views: (raw.views ?? [{ id: "default", type: "topology" }]).map((v) => ({
      id: v.id,
      type: v.type ?? "topology",
      direction: v.direction ?? raw.direction,
      ...opt("title", v.title),
      ...opt("scope", v.scope),
    })),
    scenarios: raw.scenarios.map((sc) => ({
      id: sc.id,
      label: sc.label ?? sc.id,
      steps: sc.steps.map((st) => ({ ...opt("note", st.note), nodes: st.nodes ?? {}, edges: st.edges ?? {} })),
    })),
  };
  const errors = checkSemantics(diagram, raw.edges.map((e) => e.id !== undefined));
  return errors.length ? { ok: false, errors } : { ok: true, diagram };
}

function dedupe(errors: ValidationError[]): ValidationError[] {
  const seen = new Set<string>();
  return errors.filter((e) => {
    const k = e.toString();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
