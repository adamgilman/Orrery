import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bin = join(import.meta.dirname, "../dist/main.js");
const fixtures = join(import.meta.dirname, "../../../fixtures");
const run = (...args: string[]) => {
  const r = spawnSync("node", [bin, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

describe("orrery validate", () => {
  it("exits 0 and prints OK for a valid file", () => {
    const r = run("validate", join(fixtures, "valid/three-tier.json"));
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^OK: 3 nodes, 2 edges/);
  });

  it("exits 1 and prints one pointer-addressed error per line for an invalid file", () => {
    const r = run("validate", join(fixtures, "invalid/unknown-node.json"));
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toContain('/edges/0/to: unknown node "zzz"');
  });

  it("reports a missing file", () => {
    const r = run("validate", join(fixtures, "nope.json"));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/nope\.json/);
  });

  it("reports malformed JSON with the file name", () => {
    const dir = mkdtempSync(join(tmpdir(), "orrery-"));
    const p = join(dir, "bad.json");
    writeFileSync(p, "{ nodes: [ }");
    const r = run("validate", p);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/bad\.json.*JSON/);
  });
});

describe("orrery render", () => {
  it("writes an SVG to the given output path", () => {
    const dir = mkdtempSync(join(tmpdir(), "orrery-"));
    const out = join(dir, "out.svg");
    const r = run("render", join(fixtures, "valid/three-tier.json"), "-o", out);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    const svg = readFileSync(out, "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('data-node="web"');
    expect(svg).toContain("@keyframes orrery-flow");
  });

  it("writes to stdout without -o", () => {
    const r = run("render", join(fixtures, "valid/minimal.json"));
    expect(r.code).toBe(0);
    expect(r.out.startsWith("<svg")).toBe(true);
  });

  it("is byte-for-byte deterministic across runs", () => {
    const a = run("render", join(fixtures, "valid/fan-out.json")).out;
    const b = run("render", join(fixtures, "valid/fan-out.json")).out;
    expect(a).toBe(b);
  });

  it("refuses to render an invalid file and lists the errors", () => {
    const r = run("render", join(fixtures, "invalid/duplicate-id.json"));
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toContain('/nodes/2/id: duplicate node id "a"');
  });
});

describe("orrery usage", () => {
  it("prints usage and exits 2 on an unknown command", () => {
    const r = run("frobnicate");
    expect(r.code).toBe(2);
    expect(r.err).toContain("Usage");
  });
  it("prints usage on --help", () => {
    const r = run("--help");
    expect(r.code).toBe(0);
    expect(r.out).toContain("orrery validate <file>");
    expect(r.out).toContain("orrery render <file> [-o <out.svg>]");
  });
});

describe("orrery render --view", () => {
  it("renders the named view", () => {
    const dir = mkdtempSync(join(tmpdir(), "orrery-"));
    const out = join(dir, "v.svg");
    const r = run("render", join(fixtures, "valid/grouped.json"), "--view", "data-tier", "-o", out);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    const svg = readFileSync(out, "utf8");
    expect(svg).toContain('data-node="db"');
    expect(svg).not.toContain('data-node="web"');
  });
  it("lists available views on an unknown id", () => {
    const r = run("render", join(fixtures, "valid/grouped.json"), "--view", "nope");
    expect(r.code).toBe(1);
    expect(r.err).toContain('unknown view "nope"');
    expect(r.err).toContain("overview, data-tier");
  });
  it("validate reports the view count", () => {
    const r = run("validate", join(fixtures, "valid/grouped.json"));
    expect(r.out).toBe("OK: 4 nodes, 4 edges, 3 groups, 2 views\n");
  });
});
