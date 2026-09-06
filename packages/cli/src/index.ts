import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ModelError, loadPack, packNames, render, renderDocument, renderExport, validate, type ValidationError } from "@orrery-diagrams/core";
import { ElkLayoutEngine } from "@orrery-diagrams/layout-elk";
import { RUNTIME_SOURCE } from "@orrery-diagrams/runtime";

export const USAGE = `Usage:
  orrery validate <file>                 Check a model file. Prints "OK: N components, M connections, ...", plus any
                                         warnings; or one "<file>:<json-pointer>: <message>" line per error on stderr.
  orrery render <file> [-o <out.svg>]    Validate, lay out and render one standalone SVG. Inside <img> (a README)
                 [--view <id>]           it is the animated first view; opened directly in a browser it is
                 [--static]              interactive: the model and a runtime are embedded (outline, zoom,
                 [--scenario <id>]       click to change state, scenarios). Deterministic. A file is one
                 [--step <n>]            drawing: every topology view together (--view: the one shown first),
                 [--set <state>=<ids>]   or, when --view names a sequence view, that sequence alone; a model's
                 [--play <id>]           sequences are separate files. --static: one view, no runtime.
                 [--every <seconds>]     --scenario applies a scenario's steps (cumulative) and implies
                 [--tour [<ids>]]        --static; --step <n> (1-based) stops after step n (default: last).
                 [--open <ids>]          --set failed=db,cache  declares states for a one-off what-if
                 [--zoom <id>]           (repeatable; applied after the scenario). --open draws closed groups
                 [--heading [left]]      open (comma-separated, with their closed ancestors); --zoom crops the
                                         picture to one entity. Both imply --static. --heading draws the
                                         title and description block above the picture (a view's own, else
                                         the model's), centred, or at the left edge; still or interactive.
                                         --play cycles a scenario's steps on a timer; --tour cycles views
                                         (comma-separated ids, or the model's own tour). Both are pure CSS in
                                         the file, so they play inside <img>. --every: seconds per step or view.
  orrery export <file> [--out <dir>]     Write every entry of the model's "exports" to <dir>/<id>.svg: enclosed
                                         files, CSS animation only, no script. Default <dir> is the current
                                         directory. Prints one line per file.
  orrery embed <file> [--out <dir>]      Write an embeddable diagram for a web page: <name>.svg (every topology
                                         view and drill-down, the model, the engine), <name>.<view>.svg for each
                                         sequence view, orrery.js (the engine, defining window.Orrery), and a
                                         sample index.html and app.js that build controls from the engine's
                                         interface. Replace the sample with your own page.
  orrery packs [<name>]                  List the vocabulary packs shipped with the tool (aws, azure, gcp: the
                                         providers' icons as kinds; sre: states), or one pack's names with their
                                         descriptions. A model pulls a pack in with "kinds": { "use": ["aws"] }
                                         or "states": { "use": "sre" } and then names kinds like aws:s3.
  orrery --help

Exit codes: 0 ok, 1 invalid or unreadable input, 2 usage error.
Layout is automatic; the file never contains coordinates. Every property is documented in the schema
(packages/core/schema/v1.json) and the model is specified in docs/MODEL.md.`;

export class CliError extends Error {
  constructor(message: string, public readonly exitCode: number = 1) { super(message); }
}
interface Io { stdout(s: string): void; stderr(s: string): void }

const VALUE_FLAGS = new Set(["-o", "--view", "--scenario", "--step", "--set", "--play", "--every", "--open", "--zoom", "--out"]);
/** Flags whose value may be omitted (then the model's own declaration is used). */
const OPTIONAL_VALUE_FLAGS = new Set(["--tour", "--heading"]);
const BOOL_FLAGS = new Set(["--static"]);

interface Args { positionals: string[]; values: Map<string, string[]>; flags: Set<string> }

/** One pass over argv. Every token is a known flag, its value, or a positional; anything else is a usage error. */
function parseArgs(tokens: string[]): Args {
  const args: Args = { positionals: [], values: new Map(), flags: new Set() };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (VALUE_FLAGS.has(t)) {
      const v = tokens[i + 1];
      if (v === undefined || v.startsWith("-")) throw new CliError(`${t} needs a value`, 2);
      if (t !== "--set" && args.values.has(t)) throw new CliError(`${t} given twice`, 2);
      args.values.set(t, [...(args.values.get(t) ?? []), v]);
      i++;
    } else if (OPTIONAL_VALUE_FLAGS.has(t)) {
      if (args.values.has(t) || args.flags.has(t)) throw new CliError(`${t} given twice`, 2);
      const v = tokens[i + 1];
      if (v !== undefined && !v.startsWith("-")) { args.values.set(t, [v]); i++; } else args.flags.add(t);
    } else if (BOOL_FLAGS.has(t)) args.flags.add(t);
    else if (t.startsWith("-")) throw new CliError(`unknown option ${t}`, 2);
    else args.positionals.push(t);
  }
  return args;
}
const one = (args: Args, flag: string) => args.values.get(flag)?.[0];

/** --set failed=db,cache --set off=eu → { failed: [db, cache], off: [eu] }; an entity may appear once. */
function parseSets(values: string[] | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = Object.create(null);
  const seen = new Map<string, string>();
  for (const v of values ?? []) {
    const m = v.match(/^([^=\s]+)=(.+)$/);
    if (!m) throw new CliError(`--set expects <state>=<id>[,<id>...], got "${v}"`, 2);
    for (const id of m[2]!.split(",").map((x) => x.trim()).filter(Boolean)) {
      if (seen.has(id) && seen.get(id) !== m[1]) throw new CliError(`--set names "${id}" under both "${seen.get(id)}" and "${m[1]}"`, 2);
      seen.set(id, m[1]!);
      out[m[1]!] = [...(out[m[1]!] ?? []), id];
    }
  }
  return out;
}

function loadModel(file: string, io: Io) {
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch (e) { throw new CliError(`${file}: ${(e as Error).message}`); }
  let json: unknown;
  try { json = JSON.parse(text); } catch (e) { throw new CliError(`${file}: invalid JSON: ${(e as Error).message}`); }
  const result = validate(json);
  if (!result.ok) throw new CliError(result.errors.map((e: ValidationError) => `${file}:${e.toString()}`).join("\n"));
  for (const w of result.warnings) io.stderr(`${file}:${w.toString()} (warning)\n`);
  return result.model;
}

/** `packs`: every pack on a line; `packs <name>`: every name the pack defines, qualified as a model would write it, with its description. */
function listPacks(rest: string[]): string {
  if (rest.length > 1 || rest[0]?.startsWith("-")) throw new CliError("packs takes one optional pack name and no options", 2);
  const table = (rows: [string, string][]) => { const w = Math.max(...rows.map(([k]) => k.length)); return rows.map(([k, v]) => `${k.padEnd(w)}  ${v}`).join("\n") + "\n"; };
  const name = rest[0];
  if (name === undefined) return table(packNames().map((n) => { const p = loadPack(n)!; return [n, `${p.title} (${p.version})`]; }));
  const pack = loadPack(name);
  if (!pack) throw new CliError(`unknown pack "${name}"; known: ${packNames().join(", ")}`);
  const sections: [string, [string, string][]][] = [["states", Object.entries(pack.states?.define ?? {}).map(([k, d]) => [k, d.description ?? ""])]];
  for (const section of ["components", "groups", "connections"] as const) sections.push([`kinds.${section}`, Object.entries(pack.kinds?.[section] ?? {}).map(([k, d]) => [`${name}:${k}`, d.description ?? ""])]);
  return `${pack.title} (${pack.version}), ${pack.source}\n${pack.terms}\n` + sections.filter(([, rows]) => rows.length).map(([title, rows]) => `\n${title}\n${table(rows)}`).join("");
}

/** Run the CLI. Returns the process exit code; never calls process.exit itself so it stays testable. */
export async function main(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;
  if (rest.includes("--help") || rest.includes("-h") || command === "--help" || command === "-h" || command === "help") { io.stdout(USAGE + "\n"); return 0; }
  try {
    if (command === "packs") { io.stdout(listPacks(rest)); return 0; }
    if (command !== "validate" && command !== "render" && command !== "export" && command !== "embed") throw new CliError(USAGE, 2);
    const args = parseArgs(rest);
    const [file, ...extra] = args.positionals;
    if (!file) throw new CliError(USAGE, 2);
    if (extra.length) throw new CliError(`unexpected argument ${extra[0]}`, 2);
    if (command === "validate") {
      if (args.values.size || args.flags.size) throw new CliError("validate takes no options", 2);
      const m = loadModel(file, io);
      io.stdout(`OK: ${m.components.length} components, ${m.connections.length} connections, ${m.groups.length} groups, ${m.views.length} views${m.scenarios.length ? `, ${m.scenarios.length} scenarios` : ""}${m.exports.length ? `, ${m.exports.length} exports` : ""}\n`);
      return 0;
    }
    if (command === "embed") {
      const dir = one(args, "--out") ?? ".";
      for (const flag of args.values.keys()) if (flag !== "--out") throw new CliError(`embed takes only --out, not ${flag}`, 2);
      if (args.flags.size) throw new CliError(`embed takes only --out`, 2);
      const m = loadModel(file, io);
      const name = basename(file).replace(/\.orrery\.json$|\.json$/, "");
      const title = m.title ?? name;
      // One file per drawing: the topology views together, then each sequence view alone (R17).
      const drawings: [string, string | undefined][] = [[`${name}.svg`, undefined], ...m.views.filter((v) => v.type === "sequence").map((v): [string, string] => [`${name}.${v.id}.svg`, v.id])];
      const files: [string, string][] = [];
      for (const [f, view] of drawings) {
        try { files.push([f, await renderDocument(m, new ElkLayoutEngine(), { runtime: RUNTIME_SOURCE, ...(view !== undefined ? { view } : {}) })]); } catch (e) { if (e instanceof ModelError) throw new CliError(`${file}: ${e.message}`); throw e; }
      }
      const sample = (f: string) => readFileSync(join(import.meta.dirname, "../sample", f), "utf8").replaceAll("{{name}}", name).replaceAll("{{title}}", title.replace(/[<>&]/g, ""));
      files.push(["orrery.js", RUNTIME_SOURCE], ["index.html", sample("index.html")], ["app.js", sample("app.js")]);
      try { mkdirSync(dir, { recursive: true }); } catch (e) { throw new CliError(`${dir}: ${(e as Error).message}`); }
      for (const [f, text] of files) {
        const target = join(dir, f);
        try { writeFileSync(target, text); } catch (e) { throw new CliError(`${target}: ${(e as Error).message}`); }
        io.stdout(`${target}\n`);
      }
      return 0;
    }
    if (command === "export") {
      const dir = one(args, "--out") ?? ".";
      for (const flag of args.values.keys()) if (flag !== "--out") throw new CliError(`export takes only --out, not ${flag}`, 2);
      if (args.flags.size) throw new CliError(`export takes only --out`, 2);
      const m = loadModel(file, io);
      if (!m.exports.length) throw new CliError(`${file}: the model declares no exports; add an "exports" list (docs/MODEL.md 4.9)`);
      try { mkdirSync(dir, { recursive: true }); } catch (e) { throw new CliError(`${dir}: ${(e as Error).message}`); }
      for (const x of m.exports) {
        const target = join(dir, `${x.id}.svg`);
        let svg: string;
        try { svg = await renderExport(m, new ElkLayoutEngine(), x); } catch (e) { if (e instanceof ModelError) throw new CliError(`${file}: export "${x.id}": ${e.message}`); throw e; }
        try { writeFileSync(target, svg); } catch (e) { throw new CliError(`${target}: ${(e as Error).message}`); }
        io.stdout(`${target}\n`);
      }
      return 0;
    }
    const out = one(args, "-o"), view = one(args, "--view"), scenario = one(args, "--scenario"), stepRaw = one(args, "--step"), zoom = one(args, "--zoom");
    const open = one(args, "--open")?.split(",").map((x) => x.trim()).filter(Boolean);
    if (args.values.has("--out")) throw new CliError("--out is for export; render writes one file with -o", 2);
    if (stepRaw !== undefined && scenario === undefined) throw new CliError("--step requires --scenario", 2);
    const step = stepRaw !== undefined ? Number(stepRaw) : undefined;
    if (step !== undefined && !Number.isInteger(step)) throw new CliError(`--step must be an integer, got "${stepRaw}"`, 2);
    const set = parseSets(args.values.get("--set"));
    const hasSet = Object.keys(set).length > 0;
    const playId = one(args, "--play"), everyRaw = one(args, "--every");
    const tourIds = one(args, "--tour"), tourOwn = args.flags.has("--tour");
    if (everyRaw !== undefined && playId === undefined && tourIds === undefined && !tourOwn) throw new CliError("--every requires --play or --tour", 2);
    const every = everyRaw !== undefined ? Number(everyRaw) : undefined;
    if (every !== undefined && !(every > 0)) throw new CliError(`--every must be a positive number of seconds, got "${everyRaw}"`, 2);
    const play = playId !== undefined ? { scenario: playId, ...(every !== undefined ? { seconds: every } : {}) } : undefined;
    const tour = tourIds !== undefined ? { views: tourIds.split(",").map((x) => x.trim()).filter(Boolean), ...(every !== undefined ? { seconds: every } : {}) } : tourOwn ? (true as const) : undefined;
    if (tour === true && every !== undefined) throw new CliError("--every with --tour needs an explicit list of views", 2);
    const headingValue = one(args, "--heading");
    if (headingValue !== undefined && headingValue !== "left" && headingValue !== "centre") throw new CliError(`--heading takes "left" or "centre", got "${headingValue}"`, 2);
    const heading: true | "left" | "centre" | undefined = headingValue !== undefined ? headingValue : args.flags.has("--heading") ? true : undefined;
    const isStatic = args.flags.has("--static") || scenario !== undefined || tour !== undefined || open !== undefined || zoom !== undefined;
    const model = loadModel(file, io);
    let svg: string;
    try {
      const common = { ...(view !== undefined ? { view } : {}), ...(hasSet ? { set } : {}), ...(play ? { play } : {}), ...(tour !== undefined ? { tour } : {}), ...(heading !== undefined ? { heading } : {}) };
      svg = isStatic
        ? await render(model, new ElkLayoutEngine(), { ...common, ...(scenario !== undefined ? { scenario } : {}), ...(step !== undefined ? { step } : {}), ...(open ? { open } : {}), ...(zoom !== undefined ? { zoom } : {}) })
        : await renderDocument(model, new ElkLayoutEngine(), { runtime: RUNTIME_SOURCE, ...common });
    } catch (e) {
      if (e instanceof ModelError) throw new CliError(`${file}: ${e.message}`);
      throw e;
    }
    if (out !== undefined) {
      try { writeFileSync(out, svg); } catch (e) { throw new CliError(`${out}: ${(e as Error).message}`); }
    } else io.stdout(svg);
    return 0;
  } catch (e) {
    if (e instanceof CliError) { io.stderr(e.message + "\n"); return e.exitCode; }
    throw e;
  }
}
