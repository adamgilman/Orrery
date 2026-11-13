import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validate } from "@orrery-diagrams/core";

/**
 * The README's first example is the one a newcomer pastes and runs, and the pictures beside it are what they are
 * told to expect. The model in the README is examples/try-it.orrery.json, to the letter, and `yarn examples`
 * renders that file with the README's own commands, so the page cannot show a picture the commands do not make.
 */
const root = join(import.meta.dirname, "../..");
const readme = readFileSync(join(root, "README.md"), "utf8");
const tryIt = readme.slice(readme.indexOf("## Try it"), readme.indexOf("## Why not"));

describe("the README's Try it", () => {
  it("shows the model in examples/try-it.orrery.json, and that model is valid", () => {
    const shown = tryIt.match(/```json\n([\s\S]*?)```/)?.[1];
    expect(shown, "no json block under Try it").toBeDefined();
    const file = readFileSync(join(root, "examples/try-it.orrery.json"), "utf8");
    expect(JSON.parse(shown!)).toEqual(JSON.parse(file));
    expect(validate(JSON.parse(file)).ok).toBe(true);
  });
  it("shows the pictures its two commands write, and the examples script writes them with those commands", () => {
    expect(tryIt).toContain("](examples/try-it.svg)");
    expect(tryIt).toContain("](examples/try-it-failed.svg)");
    expect(tryIt).toMatch(/render app\.orrery\.json -o app\.svg/);
    expect(tryIt).toMatch(/render app\.orrery\.json --set failed=db -o failed\.svg/);
    const script = readFileSync(join(root, "tools/examples.mjs"), "utf8");
    expect(script).toContain('run("render", "examples/try-it.orrery.json", "-o", "examples/try-it.svg")');
    expect(script).toContain('run("render", "examples/try-it.orrery.json", "--set", "failed=db", "-o", "examples/try-it-failed.svg")');
    for (const f of ["try-it.svg", "try-it-failed.svg"]) expect(readFileSync(join(root, "examples", f), "utf8"), f).toContain('data-node="db"');
    expect(readFileSync(join(root, "examples/try-it-failed.svg"), "utf8")).toMatch(/data-node="db"[^>]*data-state="failed"/);
  });
});

/** The same for the raster pictures: the GIF and the PNG in "Two ways out" are what the commands beside them write. */
describe("the README's PNG and GIF (R19)", () => {
  const out = readme.slice(readme.indexOf("## Two ways out"), readme.indexOf("## Installing"));
  it("shows a GIF and a PNG the examples script writes with the commands given", () => {
    expect(out).toContain("](examples/checkout/primary-fails.gif)");
    expect(out).toMatch(/render examples\/checkout\.orrery\.json --play db-fails -o primary-fails\.gif/);
    expect(out).toMatch(/render examples\/checkout\.orrery\.json -o overview\.png/);
    const script = readFileSync(join(root, "tools/examples.mjs"), "utf8");
    expect(script).toContain('run("render", "examples/checkout.orrery.json", "--play", "db-fails", "-o", "examples/checkout/primary-fails.gif")');
    expect(script).toContain('run("render", "examples/checkout.orrery.json", "-o", "examples/checkout/overview.png")');
  });
  it("the committed pictures are a looping GIF and a PNG, small enough to post anywhere", () => {
    const gif = readFileSync(join(root, "examples/checkout/primary-fails.gif")), png = readFileSync(join(root, "examples/checkout/overview.png"));
    expect(gif.subarray(0, 6).toString("latin1")).toBe("GIF89a");
    expect(gif.includes("NETSCAPE2.0")).toBe(true);
    expect(gif.length).toBeLessThan(1024 * 1024);
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(png.length).toBeLessThan(200 * 1024);
  });
});
