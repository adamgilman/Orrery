import { describe, expect, it } from "vitest";
import { loadPack, packNames, validate, type Glyph, type Model } from "../src/index.js";

const inline = (input: unknown): Model => { const r = validate(input); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.model; };
const KIND_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
const glyphOf = (m: Model, kind: string) => m.kinds.components[kind]?.glyph as Glyph;

describe("packs: the shipped files", () => {
  it("ships aws, azure, gcp and sre, each naming its source and terms", () => {
    expect(packNames()).toEqual(["aws", "azure", "gcp", "sre"]);
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
      '/states/use: unknown pack "ops"; known: aws, azure, gcp, sre',
      '/kinds/use/1: unknown pack "ibm"; known: aws, azure, gcp, sre',
    ]);
  });
});
