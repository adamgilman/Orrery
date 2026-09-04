import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validate } from "../src/index.js";

const fixtures = join(import.meta.dirname, "../../../fixtures");
const load = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const names = (dir: string) =>
  readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".errors.json")).map((f) => f.replace(/\.json$/, ""));

describe("validate: valid fixtures", () => {
  for (const name of names(join(fixtures, "valid"))) {
    it(`${name} is accepted`, () => {
      const result = validate(load(join(fixtures, "valid", `${name}.json`)));
      expect(result.ok, JSON.stringify(result)).toBe(true);
    });
  }
});

describe("validate: invalid fixtures", () => {
  for (const name of names(join(fixtures, "invalid"))) {
    it(`${name} is rejected with the expected pointers`, () => {
      const expected: { pointer: string; message: string }[] = load(join(fixtures, "invalid", `${name}.errors.json`));
      const result = validate(load(join(fixtures, "invalid", `${name}.json`)));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.map((e) => e.pointer).sort()).toEqual(expected.map((e) => e.pointer).sort());
      for (const exp of expected) {
        const match = result.errors.find((e) => e.pointer === exp.pointer && e.message.includes(exp.message));
        expect(match, `expected ${exp.pointer} to contain "${exp.message}", got ${JSON.stringify(result.errors)}`).toBeDefined();
      }
    });
  }
});

describe("validate: normalisation", () => {
  it("applies defaults for direction, load and label", () => {
    const result = validate({ nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagram.direction).toBe("right");
    expect(result.diagram.nodes[0]?.label).toBe("a");
    expect(result.diagram.edges[0]?.load).toBe(0.5);
  });

  it("does not mutate its input", () => {
    const input = { nodes: [{ id: "a" }], edges: [] };
    const copy = structuredClone(input);
    validate(input);
    expect(input).toEqual(copy);
  });

  it("formats errors as pointer: message lines", () => {
    const result = validate({ nodes: [{ id: "a" }], edges: [{ from: "a", to: "nope" }] });
    if (result.ok) throw new Error("expected failure");
    expect(result.errors[0]?.toString()).toBe('/edges/0/to: unknown node "nope"');
  });
});
