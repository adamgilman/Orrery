import { readFileSync } from "node:fs";
import { Ajv, type ErrorObject } from "ajv";
import type { Diagram } from "./types.js";

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

export const schema: object = JSON.parse(readFileSync(new URL("../schema/v1.json", import.meta.url), "utf8"));

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

/** Semantic checks that JSON Schema cannot express. Runs only on schema-valid input. */
function checkSemantics(d: Diagram): ValidationError[] {
  const errors: ValidationError[] = [];
  const ids = new Set<string>();
  d.nodes.forEach((n, i) => {
    if (ids.has(n.id)) errors.push(new ValidationError(`/nodes/${i}/id`, `duplicate node id "${n.id}"`));
    ids.add(n.id);
  });
  d.edges.forEach((e, i) => {
    if (!ids.has(e.from)) errors.push(new ValidationError(`/edges/${i}/from`, `unknown node "${e.from}"`));
    if (!ids.has(e.to)) errors.push(new ValidationError(`/edges/${i}/to`, `unknown node "${e.to}"`));
    if (e.from === e.to && ids.has(e.from)) errors.push(new ValidationError(`/edges/${i}`, `self-referencing edge "${e.from}"`));
  });
  return errors;
}

/** Validate an untrusted JSON value and return a normalised Diagram or a list of pointer-addressed errors. */
export function validate(input: unknown): ValidationResult {
  const data: unknown = structuredClone(input); // useDefaults mutates; never touch the caller's object
  if (!checkSchema(data)) {
    const errors = (checkSchema.errors ?? []).map(describe);
    return { ok: false, errors: dedupe(errors) };
  }
  const raw = data as Diagram & { $schema?: string };
  const diagram: Diagram = {
    ...(raw.title !== undefined ? { title: raw.title } : {}),
    direction: raw.direction,
    nodes: raw.nodes.map((n) => ({ id: n.id, label: n.label ?? n.id })),
    edges: raw.edges.map((e) => ({ from: e.from, to: e.to, load: e.load, ...(e.label !== undefined ? { label: e.label } : {}) })),
  };
  const errors = checkSemantics(diagram);
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
