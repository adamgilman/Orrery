import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "../../..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });

describe("ELK quarantine", () => {
  it("only @orrery/layout-elk imports elkjs", () => {
    const offenders = readdirSync(join(root, "packages"))
      .filter((p) => p !== "layout-elk")
      .flatMap((p) => walk(join(root, "packages", p, "src")))
      .filter((f) => /from\s+["']elkjs/.test(readFileSync(f, "utf8")))
      .map((f) => relative(root, f));
    expect(offenders).toEqual([]);
  });
});
