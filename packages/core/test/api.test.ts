import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as core from "../src/index.js";
import * as testing from "../src/testing.js";
import * as internal from "../src/internal.js";

/**
 * The public API is a list, and this test is the list. Adding a name to the root export is a semver decision made
 * here, in a diff a reviewer reads; everything else lives behind /internal or /testing, reachable and unpromised.
 */
describe("the public API of @orrery-diagrams/core", () => {
  it("is exactly these runtime exports, and no more", () => {
    expect(Object.keys(core).sort()).toEqual([
      "ModelError",
      "PROVIDER_PACKS",
      "ValidationError",
      "ValidationWarning",
      "declare",
      "installHint",
      "loadPack",
      "packNames",
      "packProblem",
      "render",
      "renderDocument",
      "renderExport",
      "sanitizeGlyph",
      "schema",
      "validate",
    ]);
  });
  it("keeps test doubles and internals behind their own subpaths", () => {
    expect(Object.keys(testing)).toEqual(["FakeLayoutEngine"]);
    expect(Object.keys(core)).not.toContain("FakeLayoutEngine");
    for (const name of ["toLayoutGraph", "scopeModel", "CSS_COLOR", "PATH_DATA", "DEFAULT_STATES", "flowDuration", "renderSvg", "applySet", "GROUP_PADDING", "layoutSequence"]) {
      expect(internal, name).toHaveProperty(name);
      expect(core, name).not.toHaveProperty(name);
    }
  });
  it("publishes exactly the documented entry points", () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")) as { exports: Record<string, unknown> };
    expect(Object.keys(pkg.exports)).toEqual([".", "./types", "./declare", "./testing", "./internal", "./internal/*"]);
  });
});
