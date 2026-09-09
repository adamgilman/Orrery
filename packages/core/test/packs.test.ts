import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PROVIDER_PACKS, installHint, loadPack, packNames, packProblem, render, validate, type Glyph, type Model, type Pack } from "../src/index.js";
import { FakeLayoutEngine } from "../src/testing.js";

const root = join(import.meta.dirname, "../../..");
const json = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"));

const inline = (input: unknown): Model => { const r = validate(input); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.model; };
const KIND_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
const glyphOf = (m: Model, kind: string) => m.kinds.components[kind]?.glyph as Glyph;

describe("packs: the providers' icons are separate packages under their own terms", () => {
  it("the tool itself ships only sre; each provider pack is its own package, licensed by the provider, not MIT", () => {
    expect(readdirSync(join(root, "packages/core/packs")).sort()).toEqual(["sre.json", "user.json"]); // ours; a provider's set is its own package
    expect(Object.keys(PROVIDER_PACKS)).toEqual(["aws", "azure", "gcp"]);
    const version = json("packages/core/package.json").version;
    for (const [name, info] of Object.entries(PROVIDER_PACKS)) {
      const dir = `packages/pack-${name}`;
      const manifest = json(`${dir}/package.json`);
      expect(manifest.name, name).toBe(`@orrery-diagrams/pack-${name}`);
      expect(info.package).toBe(manifest.name);
      expect(manifest.version, name).toBe(version);
      expect(manifest.license, name).toBe("SEE LICENSE IN LICENSE");
      expect(manifest.main, name).toBe("pack.json");
      expect(manifest.files, name).toEqual(expect.arrayContaining(["pack.json", "LICENSE", "README.md"]));
      const licence = readFileSync(join(root, dir, "LICENSE"), "utf8");
      const pack = json(`${dir}/pack.json`) as Pack;
      expect(licence, name).toContain(pack.terms);
      expect(licence, name).toContain(pack.source);
      expect(licence, name).not.toMatch(/MIT License|Permission is hereby granted/);
      expect(readFileSync(join(root, dir, "README.md"), "utf8"), name).toContain(manifest.name);
      expect(existsSync(join(root, "packages/core/packs", `${name}.json`)), name).toBe(false);
    }
    const cli = json("packages/cli/package.json");
    expect(Object.keys({ ...cli.dependencies, ...cli.optionalDependencies, ...cli.peerDependencies }).filter((d) => d.includes("pack-"))).toEqual([]);
  });
  it("names the package to install and whose terms it carries; an unknown name lists the known ones", () => {
    expect(installHint("aws")).toBe('pack "aws" is not installed: add @orrery-diagrams/pack-aws (AWS Architecture Icons, Amazon Web Services\' icons under their terms)');
    expect(installHint("azure")).toContain("@orrery-diagrams/pack-azure (Azure Public Service Icons, Microsoft's icons under their terms)");
    expect(installHint("gcp")).toContain("@orrery-diagrams/pack-gcp (Google Cloud product icons, Google's icons under their terms)");
    expect(packProblem("ibm")).toBe('unknown pack "ibm"; known: aws, azure, gcp, sre, user');
    expect(packProblem("aws")).toBeUndefined(); // installed in this workspace
    expect(packProblem("sre")).toBeUndefined();
  });
  it("validate takes packs given in code, for a browser or a bundler, ahead of anything installed", () => {
    const mine: Pack = { name: "mine", title: "Mine", version: "1", source: "here", terms: "yours", kinds: { components: { thing: { glyph: { viewBox: "0 0 10 10", svg: "<circle cx=\"5\" cy=\"5\" r=\"4\"/>" } } } } };
    const r = validate({ kinds: { use: ["mine"] }, components: [{ id: "a", kind: "mine:thing" }] }, { packs: [mine] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.model.kinds.components["mine:thing"]!.glyph as Glyph).viewBox).toBe("0 0 10 10");
    const aws: Pack = { name: "aws", title: "Not AWS", version: "0", source: "test", terms: "none", kinds: { components: { only: { glyph: "storage" } } } };
    const shadowed = validate({ kinds: { use: ["aws"] }, components: [{ id: "a", kind: "aws:only" }] }, { packs: [aws] });
    expect(shadowed.ok).toBe(true);
    expect(validate({ kinds: { use: ["aws"] }, components: [{ id: "a", kind: "aws:s3" }] }, { packs: [aws] }).ok).toBe(false);
  });
});

describe("packs: the shipped files", () => {
  it("knows aws, azure, gcp and sre, each naming its source and terms", () => {
    expect(packNames()).toEqual(["aws", "azure", "gcp", "sre", "user"]);
    for (const name of packNames()) {
      const p = loadPack(name)!;
      expect(p.name).toBe(name);
      for (const field of ["title", "version", "source", "terms"] as const) expect(p[field], `${name}.${field}`).toMatch(/\S/);
    }
    expect(loadPack("nope")).toBeUndefined();
    expect(loadPack("../package")).toBeUndefined();
  });
  it("every cloud kind has a legal unqualified name, a description and an icon glyph with a viewBox and safe markup", () => {
    const sizes: Record<string, number> = { aws: 300, azure: 500, gcp: 200 };
    for (const [name, atLeast] of Object.entries(sizes)) {
      const kinds = loadPack(name)!.kinds!;
      expect(Object.keys(kinds.components!).length, name).toBeGreaterThanOrEqual(atLeast);
      for (const [kind, def] of Object.entries(kinds.components!)) {
        expect(kind, `${name}:${kind}`).toMatch(KIND_NAME);
        expect(def.description, `${name}:${kind}`).toMatch(/\S/);
        const g = def.glyph as Glyph;
        expect(g.viewBox, `${name}:${kind}`).toMatch(/^[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+$/);
        expect(g.svg, `${name}:${kind}`).toMatch(/^</);
        expect(g.svg, `${name}:${kind}`).not.toMatch(/<(script|foreignObject|image|style)\b|\bon[a-z]+=|<\?xml|<!--|<title/i);
      }
      expect(Object.keys(kinds.groups!).length, `${name} groups`).toBeGreaterThan(2);
    }
  });
  it("carries the names people say as aliases of the derived names", () => {
    const same = (pack: string, alias: string, derived: string) => {
      const c = loadPack(pack)!.kinds!.components!;
      expect(c[alias], `${pack}:${alias}`).toBeDefined();
      expect(c[derived], `${pack}:${derived}`).toBeDefined();
      expect((c[alias]!.glyph as Glyph).svg).toBe((c[derived]!.glyph as Glyph).svg);
    };
    same("aws", "s3", "simple-storage-service"); same("aws", "lambda", "lambda"); same("aws", "ec2", "ec2"); same("aws", "rds", "rds");
    same("aws", "dynamodb", "dynamodb"); same("aws", "sqs", "simple-queue-service"); same("aws", "sns", "simple-notification-service"); same("aws", "eks", "elastic-kubernetes-service");
    same("gcp", "run", "cloud-run"); same("gcp", "gke", "gke"); same("gcp", "cloudsql", "cloud-sql"); same("gcp", "pubsub", "pubsub");
    same("azure", "aks", "kubernetes-services"); same("azure", "cosmos", "azure-cosmos-db"); same("azure", "functions", "function-apps"); same("azure", "app-service", "app-services");
    same("azure", "blob", "storage-accounts"); same("azure", "service-bus", "azure-service-bus"); same("azure", "key-vault", "key-vaults");
  });
});

describe("packs: user, the basic pieces of a diagram", () => {
  it("ships with the tool and names a person, a device, a computer and a house", () => {
    const pack = loadPack("user")!;
    expect(pack, "the user pack is not there").toBeDefined();
    expect(pack.terms).toMatch(/MIT/);
    const c = pack.kinds!.components!;
    expect(Object.keys(c)).toEqual(expect.arrayContaining(["user", "device", "computer", "house"]));
    for (const [name, def] of Object.entries(c)) {
      expect(name, name).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(def.description, name).toMatch(/\S/);
      expect(typeof def.glyph, `${name} draws with the theme's stroke, so its glyph is path data`).toBe("string");
      expect(def.glyph as string, name).toMatch(/^[Mm][\d\s.,+a-zA-Z-]+$/);
    }
  });
  it("answers to the names people say", () => {
    const c = loadPack("user")!.kinds!.components!;
    for (const [alias, target] of [["person", "user"], ["phone", "device"], ["laptop", "computer"], ["home", "house"]]) {
      expect(c[alias!], alias).toBeDefined();
      expect(c[alias!]!.glyph, alias).toBe(c[target!]!.glyph);
    }
  });
  it("draws a component of every one of its kinds", async () => {
    const m = inline({ kinds: { use: ["user"] }, components: [{ id: "a", kind: "user:user" }, { id: "b", kind: "user:device" }, { id: "c", kind: "user:computer" }, { id: "d", kind: "user:house" }] });
    for (const kind of ["user:user", "user:device", "user:computer", "user:house"]) expect(m.kinds.components[kind], kind).toBeDefined();
    const svg = await render(m, new FakeLayoutEngine());
    expect((svg.match(/<g class="glyph"/g) ?? []).length).toBe(4);
  });
});

describe("packs: use (R13)", () => {
  it("kinds.use merges a pack's kinds under its prefix, after the defaults and before the author's own", () => {
    const m = inline({ kinds: { use: ["aws"], components: { "aws:s3": { box: { fill: "#fff7ed" } }, bucket: { glyph: "storage" } } }, components: [{ id: "a", kind: "aws:s3" }, { id: "b", kind: "aws:lambda" }, { id: "c", kind: "bucket" }], groups: [{ id: "v", kind: "aws:vpc" }] });
    expect(glyphOf(m, "aws:s3").viewBox).toBe("0 0 64 64");
    expect(m.kinds.components["aws:s3"]!.box).toEqual({ fill: "#fff7ed" });
    expect(m.kinds.components["aws:s3"]!.description).toContain("Simple Storage Service");
    expect(m.kinds.components.database?.glyph).toBe("database");
    expect(m.kinds.groups["aws:vpc"]!.frame).toMatchObject({ dash: true });
  });
  it("replace: true drops the defaults and keeps the packs asked for; later packs win over earlier ones", () => {
    const m = inline({ kinds: { use: "gcp", replace: true }, components: [{ id: "a", kind: "gcp:run" }] });
    expect(m.kinds.components.database).toBeUndefined();
    expect(glyphOf(m, "gcp:run")).toBeDefined();
    const two = inline({ kinds: { use: ["aws", "azure"] }, components: [{ id: "a", kind: "aws:s3" }, { id: "b", kind: "azure:blob" }] });
    expect(glyphOf(two, "aws:s3")).toBeDefined(); expect(glyphOf(two, "azure:blob")).toBeDefined();
  });
  it("states.use pulls in a states vocabulary unprefixed; the author's define merges onto it", () => {
    const m = inline({ states: { use: "sre", define: { brownout: { description: "Feature flags off" } } }, components: [{ id: "a", state: "drained" }] });
    expect(Object.keys(m.states.define)).toEqual(["healthy", "impaired", "brownout", "outage", "drained"]);
    expect(m.states.default).toBe("healthy");
    expect(m.states.define.brownout).toMatchObject({ look: { stroke: "#7c3aed" }, description: "Feature flags off" });
    expect(m.states.define.drained!.flows).toBe("stop");
    expect(m.components[0]!.state).toBe("drained");
  });
  it("rejects an unknown pack, naming the ones that exist", () => {
    const r = validate({ kinds: { use: ["aws", "ibm"] }, states: { use: "ops" }, components: [{ id: "a" }] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.toString())).toEqual([
      '/states/use: unknown pack "ops"; known: aws, azure, gcp, sre, user',
      '/kinds/use/1: unknown pack "ibm"; known: aws, azure, gcp, sre, user',
    ]);
  });
});
