/**
 * The Claude Code skill (plugins/orrery) must stay true to the tool: every complete JSON block in it validates,
 * the generated references match their sources, every schema property is shown in the variants, the manifests
 * point at files that exist, and SKILL.md keeps its shape.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { schema, validate } from "@orrery-diagrams/core";

const root = join(import.meta.dirname, "../..");
const skill = join(root, "plugins/orrery/skills/orrery-diagrams");
const read = (p: string) => readFileSync(join(skill, p), "utf8");
const jsonBlocks = (md: string) => [...md.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]!);

describe("the orrery skill", () => {
  it("has a manifest, a marketplace entry and a SKILL.md that name real things", () => {
    const plugin = JSON.parse(readFileSync(join(root, "plugins/orrery/.claude-plugin/plugin.json"), "utf8"));
    const market = JSON.parse(readFileSync(join(root, ".claude-plugin/marketplace.json"), "utf8"));
    expect(plugin.name).toBe("orrery");
    expect(market.plugins.map((p: { name: string; source: string }) => [p.name, p.source])).toEqual([["orrery", "./plugins/orrery"]]);
    expect(existsSync(join(root, market.plugins[0].source, ".claude-plugin/plugin.json"))).toBe(true);
    const md = read("SKILL.md");
    const front = md.match(/^---\n([\s\S]*?)\n---/)![1]!;
    expect(front).toMatch(/^name: orrery-diagrams$/m);
    expect(front).toMatch(/^description: This skill should be used when the user asks to "/m);
    expect(md.split(/\s+/).length).toBeLessThan(2500);
    for (const ref of [...md.matchAll(/`(references\/[\w-]+\.md|assets\/[\w.-]+|scripts\/[\w.-]+)`/g)].map((m) => m[1]!)) expect(existsSync(join(skill, ref)), ref).toBe(true);
    expect(md).toContain("packages/core/schema/v1.json"); // the schema is the reference
  });
  it("every complete JSON block in the references and assets validates against the schema", () => {
    const files = ["references/variants.md", "references/examples.md"];
    let n = 0;
    for (const f of files) for (const block of jsonBlocks(read(f))) {
      const r = validate(JSON.parse(block));
      expect(r.ok, `${f}: ${block.slice(0, 80)}… ${r.ok ? "" : JSON.stringify(r.errors)}`).toBe(true);
      n++;
    }
    expect(n).toBeGreaterThan(15);
    const starter = validate(JSON.parse(read("assets/starter.orrery.json")));
    expect(starter.ok, JSON.stringify(starter)).toBe(true);
  });
  it("shows every schema property somewhere in the variants or the examples", () => {
    const shown = read("references/variants.md") + read("references/examples.md");
    const walk = (node: any, path: string, out: string[]) => {
      for (const [k, p] of Object.entries<any>(node.properties ?? {})) { if (k !== "$schema") out.push(k); walk(p, `${path}/${k}`, out); }
      if (node.items) walk(node.items, path, out);
      if (typeof node.additionalProperties === "object") walk(node.additionalProperties, `${path}/*`, out);
      for (const alt of node.oneOf ?? []) walk(alt, path, out);
    };
    const keys: string[] = [];
    walk(schema, "", keys);
    const missing = [...new Set(keys)].filter((k) => !new RegExp(`"${k}"`).test(shown)).sort();
    expect(missing, "add an example of these to references/variants.md").toEqual([]);
  });
  it("the generated references match their sources", () => {
    const before = ["model.md", "examples.md", "errors.md"].map((f) => read(`references/${f}`));
    execFileSync("node", ["tools/skill-refs.mjs"], { cwd: root, stdio: "pipe" });
    const after = ["model.md", "examples.md", "errors.md"].map((f) => read(`references/${f}`));
    expect(after, "run node tools/skill-refs.mjs and commit").toEqual(before);
  });
});
