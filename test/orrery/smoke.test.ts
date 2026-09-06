/** Smoke: the built command line, run as a user would, on the diagram of Orrery. Fast, one pass per command. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Each command lays the whole diagram out through ELK; the export does it fifteen times, twice. */
const SLOW = 120_000;

const root = join(import.meta.dirname, "../..");
const bin = join(root, "packages/cli/dist/main.js");
const file = join(root, "examples/orrery.orrery.json");
const run = (...args: string[]) => { const r = spawnSync("node", [bin, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); return { code: r.status, out: r.stdout, err: r.stderr }; };

describe("smoke: the orrery command on the diagram of Orrery", () => {
  it("validates with no warnings", { timeout: SLOW }, () => {
    const r = run("validate", file);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^OK: \d+ components, \d+ connections, \d+ groups, 5 views, 2 scenarios, \d+ exports/);
  });
  it("renders the interactive file with the model and the engine inside, and a static one without", { timeout: SLOW }, () => {
    const doc = run("render", file);
    expect(doc.code).toBe(0);
    expect(doc.out).toContain('id="orrery-model"');
    expect(doc.out).toMatch(/<script><!\[CDATA\["use strict";var Orrery=/); // the engine, inlined
    expect((doc.out.match(/<g class="view"/g) ?? []).length).toBeGreaterThan(4); // one layer per view and per open configuration
    const still = run("render", file, "--static");
    expect(still.code).toBe(0);
    expect(still.out).not.toContain("orrery-model");
    expect(still.out.trim().endsWith("</svg>")).toBe(true);
  });
  it("exports every picture the model lists, byte for byte the same twice", { timeout: SLOW }, () => {
    const a = mkdtempSync(join(tmpdir(), "orrery-smoke-")), b = mkdtempSync(join(tmpdir(), "orrery-smoke-"));
    const r = run("export", file, "--out", a);
    expect(r.err).toBe(""); expect(r.code).toBe(0);
    const ids = JSON.parse(readFileSync(file, "utf8")).exports.map((x: { id: string }) => x.id);
    expect(readdirSync(a).sort()).toEqual(ids.map((i: string) => `${i}.svg`).sort());
    run("export", file, "--out", b);
    for (const f of readdirSync(a)) expect(readFileSync(join(a, f), "utf8"), f).toBe(readFileSync(join(b, f), "utf8"));
  });
  it("embeds a page, and lists the packs the diagram uses", { timeout: SLOW }, () => {
    const dir = mkdtempSync(join(tmpdir(), "orrery-smoke-"));
    const r = run("embed", file, "--out", dir);
    expect(r.code).toBe(0);
    expect(readdirSync(dir).sort()).toEqual(["app.js", "index.html", "orrery.js", "orrery.svg"]);
    const packs = run("packs");
    expect(packs.code).toBe(0);
    for (const p of ["aws", "azure", "gcp", "sre"]) expect(packs.out).toMatch(new RegExp(`^${p}\\s`, "m"));
  });
});
