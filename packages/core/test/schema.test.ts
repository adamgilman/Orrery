import { describe, expect, it } from "vitest";
import { schema } from "../src/index.js";

/** Agents read the schema cold. Every property must explain itself. */
const walk = (node: any, path: string, out: string[]) => {
  if (!node || typeof node !== "object") return;
  for (const [key, prop] of Object.entries<any>(node.properties ?? {})) {
    if (key !== "$schema" && typeof prop.description !== "string") out.push(`${path}/${key}`);
    walk(prop, `${path}/${key}`, out);
  }
  if (node.items) walk(node.items, `${path}/items`, out);
};

describe("schema v1", () => {
  it("documents every property with a description", () => {
    const missing: string[] = [];
    walk(schema, "", missing);
    expect(missing).toEqual([]);
  });
  it("requires non-empty labels on components, connections and groups", () => {
    for (const k of ["components", "connections", "groups"]) expect((schema as any).properties[k].items.properties.label.minLength, k).toBe(1);
  });
  it("only requires components at the top level", () => {
    expect((schema as any).required).toEqual(["components"]);
  });
});
