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
    expect(r.out).toMatch(/^OK: 3 components, 2 connections/);
  });

  it("exits 1 and prints one pointer-addressed error per line for an invalid file", () => {
    const r = run("validate", join(fixtures, "invalid/unknown-entity.json"));
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toContain('/connections/0/to: unknown entity "zzz"');
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
    expect(r.err).toContain('/components/2/id: duplicate component id "a"');
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
    const r = run("render", join(fixtures, "valid/grouped.json"), "--view", "data-tier", "--static", "-o", out);
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
    expect(r.out).toBe("OK: 4 components, 4 connections, 3 groups, 2 views\n");
  });
});

describe("orrery <command> --help", () => {
  it("prints usage for a subcommand instead of treating --help as a file", () => {
    for (const cmd of ["validate", "render"]) {
      const r = run(cmd, "--help");
      expect(r.code, cmd).toBe(0);
      expect(r.out, cmd).toContain("Usage");
      expect(r.err, cmd).toBe("");
    }
  });
});

describe("orrery render --scenario", () => {
  it("renders a scenario step", () => {
    const dir = mkdtempSync(join(tmpdir(), "orrery-"));
    const out = join(dir, "s.svg");
    const r = run("render", join(fixtures, "valid/alternatives.json"), "--scenario", "orders-failover", "--step", "1", "-o", out);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    const svg = readFileSync(out, "utf8");
    expect(svg).toContain('data-state="failed"');
    expect(svg).toContain("Primary goes down");
  });
  it("defaults to the last step and rejects bad ids and steps", () => {
    expect(run("render", join(fixtures, "valid/alternatives.json"), "--scenario", "orders-failover").out).toContain("(4/4)");
    const bad = run("render", join(fixtures, "valid/alternatives.json"), "--scenario", "nope");
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('unknown scenario "nope"');
    const range = run("render", join(fixtures, "valid/alternatives.json"), "--scenario", "orders-failover", "--step", "9");
    expect(range.code).toBe(1);
    expect(range.err).toContain("between 1 and 4");
    const noScenario = run("render", join(fixtures, "valid/alternatives.json"), "--step", "1");
    expect(noScenario.code).toBe(2);
  });
  it("validate counts scenarios and prints warnings without failing", () => {
    expect(run("validate", join(fixtures, "valid/alternatives.json")).out).toContain(", 2 scenarios");
    const w = run("validate", join(fixtures, "valid/warning-double.json"));
    expect(w.code).toBe(0);
    expect(w.err).toContain("(warning)");
  });
  it("--set declares states for a one-off what-if", () => {
    const r = run("render", join(fixtures, "valid/alternatives.json"), "--static", "--set", "failed=orders,fraud");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/data-node="orders"[^>]*data-state="failed"/);
    expect(r.out).toMatch(/data-node="fraud"[^>]*data-state="failed"/);
    expect(r.out).toMatch(/data-node="api"[^>]*data-state="on"/); // the what-if says nothing about the API, so nothing changes
    const bad = run("render", join(fixtures, "valid/alternatives.json"), "--set", "broken=orders");
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('unknown state "broken"');
    expect(run("render", join(fixtures, "valid/alternatives.json"), "--set", "nonsense").code).toBe(2);
  });
});

describe("orrery render: interactive document by default", () => {
  it("embeds every view, the model and the runtime; --static strips them to one view", () => {
    const dir = mkdtempSync(join(tmpdir(), "orrery-"));
    const full = join(dir, "full.svg"), stat = join(dir, "static.svg");
    expect(run("render", join(fixtures, "valid/grouped.json"), "-o", full).code).toBe(0);
    const svg = readFileSync(full, "utf8");
    expect((svg.match(/<g class="view"/g) ?? []).length).toBe(2);
    expect(svg).toContain('id="orrery-model"');
    expect(svg).toMatch(/<script><!\[CDATA\[/);
    expect(run("render", join(fixtures, "valid/grouped.json"), "--static", "-o", stat).code).toBe(0);
    const s = readFileSync(stat, "utf8");
    expect((s.match(/<g class="view"/g) ?? []).length).toBe(1);
    expect(s).not.toContain("orrery-model");
    expect(s).not.toMatch(/<script/);
  });
  it("--view with an interactive document makes that view the visible first layer", () => {
    const r = run("render", join(fixtures, "valid/grouped.json"), "--view", "data-tier");
    expect(r.code).toBe(0);
    const layers = [...r.out.matchAll(/<g class="view"( style="display:none")? data-view="([^"]+)"/g)].map((m) => [m[2], !!m[1]]);
    expect(layers).toEqual([["data-tier", false], ["overview", true]]);
  });
  it("--scenario renders a static snapshot of that step", () => {
    const r = run("render", join(fixtures, "valid/alternatives.json"), "--scenario", "orders-failover", "--step", "1");
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/<script/);
    expect(r.out).toContain('data-state="failed"');
  });
});

describe("orrery argument parsing", () => {
  const f = join(fixtures, "valid/alternatives.json");
  it("rejects unknown options, stray arguments, missing values and repeated flags with exit 2", () => {
    expect(run("render", f, "--frobnicate").code).toBe(2);
    expect(run("validate", f, "extra").code).toBe(2);
    const missing = run("render", f, "-o");
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("-o needs a value");
    expect(run("render", f, "-o", "--static").code).toBe(2);
    expect(run("render", f, "--view", "overview", "--view", "overview").code).toBe(2);
  });
  it("rejects one entity under two states across repeated --set", () => {
    const r = run("render", f, "--set", "failed=orders", "--set", "off=orders");
    expect(r.code).toBe(2);
    expect(r.err).toContain('"orders" under both');
  });
  it("--set after --scenario composes on the scenario's declared states", () => {
    const r = run("render", f, "--scenario", "orders-failover", "--step", "1", "--set", "on=orders");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/data-node="orders"[^>]*data-state="on"/);
    expect(r.out).toMatch(/data-node="api"[^>]*data-state="degraded"/); // the step's word about the API stands
  });
  it("reports an unwritable output path without a stack trace", () => {
    const r = run("render", f, "-o", "/proc/nope/out.svg");
    expect(r.code).toBe(1);
    expect(r.err).toContain("/proc/nope/out.svg");
    expect(r.err).not.toContain("    at ");
  });
});

describe("orrery render --play", () => {
  it("renders a static file that cycles through a scenario", () => {
    const r = run("render", join(fixtures, "valid/alternatives.json"), "--static", "--play", "orders-failover", "--every", "4");
    expect(r.code).toBe(0);
    expect((r.out.match(/<g class="step"/g) ?? []).length).toBe(5);
    expect(r.out).toContain("20s step-end infinite");
    expect(run("render", join(fixtures, "valid/alternatives.json"), "--every", "4").code).toBe(2);
    expect(run("render", join(fixtures, "valid/alternatives.json"), "--play", "nope").code).toBe(1);
  });
});

describe("orrery render --tour", () => {
  it("renders a static crossfading tour of views", () => {
    const r = run("render", join(fixtures, "valid/drill-down.json"), "--tour", "overview,payments", "--every", "5");
    expect(r.code).toBe(0);
    expect((r.out.match(/<g class="tour"/g) ?? []).length).toBe(2);
    expect(r.out).toContain("10s linear infinite");
    expect(r.out).not.toMatch(/<script/);
    const own = run("render", join(fixtures, "valid/drill-down.json"), "--tour");
    expect(own.code).toBe(0);
    expect(own.out).toContain('<g class="camera"'); // one drawing, a camera, state layers
    expect((own.out.match(/<g class="state" data-state="\d+" style=/g) ?? []).length).toBe(2); // two pictures; the legend strip is a separate layer
  });
});
