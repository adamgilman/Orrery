import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * What a published package carries, and what the changelog says it carried. Both went wrong once: the five MIT
 * packages shipped no licence notice, which the MIT licence itself requires to accompany copies, and a duplicate
 * "Unreleased" heading meant four fixes were tagged and released while the changelog still called them unreleased.
 */
const root = join(import.meta.dirname, "../..");
const json = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8")) as Record<string, unknown>;
const workspaces = readdirSync(join(root, "packages")).sort();
const PACKS = workspaces.filter((w) => w.startsWith("pack-"));
const OURS = workspaces.filter((w) => !w.startsWith("pack-"));

describe("every workspace carries what a package must", () => {
  it("has a manifest, a README and a licence notice", () => {
    for (const w of workspaces) {
      const files = readdirSync(join(root, "packages", w));
      expect(files, w).toContain("package.json");
      expect(files, w).toContain("README.md");
      expect(files, `${w} ships no LICENSE; npm includes one only from the package's own directory`).toContain("LICENSE");
    }
  });
  it("says MIT and carries the project's notice, or says the provider's terms and carries those", () => {
    const mit = readFileSync(join(root, "LICENSE"), "utf8");
    expect(OURS.length).toBeGreaterThan(4);
    for (const w of OURS) {
      expect(json(`packages/${w}/package.json`).license, w).toBe("MIT");
      expect(readFileSync(join(root, "packages", w, "LICENSE"), "utf8"), `${w}'s notice must be the project's`).toBe(mit);
    }
    for (const w of PACKS) {
      expect(json(`packages/${w}/package.json`).license, w).toBe("SEE LICENSE IN LICENSE");
      const notice = readFileSync(join(root, "packages", w, "LICENSE"), "utf8");
      expect(notice, w).not.toBe(mit);
      expect(notice, w).toMatch(/not covered by the MIT licence of Orrery/);
    }
  });
});

describe("the changelog", () => {
  const lines = readFileSync(join(root, "CHANGELOG.md"), "utf8").split("\n");
  const headings = lines.filter((l) => l.startsWith("## "));
  it("has at most one Unreleased section, and it comes first", () => {
    const unreleased = headings.filter((h) => /^## Unreleased/.test(h));
    expect(unreleased.length, "a second Unreleased section hides shipped changes below a version heading").toBeLessThanOrEqual(1);
    if (unreleased.length) expect(headings[0]).toMatch(/^## Unreleased/);
  });
  it("lists the released versions newest first, and the newest is the version the packages carry", () => {
    const versions = headings.filter((h) => /^## \d/.test(h)).map((h) => h.slice(3).split(" ")[0]!);
    expect(versions[0], "the top version entry is not the one the packages carry").toBe(json("packages/core/package.json").version);
    const key = (v: string) => v.split(".").map((n) => Number(n).toString().padStart(4, "0")).join(".");
    expect([...versions].sort((a, b) => key(b).localeCompare(key(a)))).toEqual(versions);
  });
});
