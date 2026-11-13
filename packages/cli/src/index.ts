import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ModelError, PROVIDER_PACKS, installHint, loadPack, packNames, packProblem, render, renderDocument, renderExport, validate, type ValidationError } from "@orrery-diagrams/core";
import { ElkLayoutEngine } from "@orrery-diagrams/layout-elk";
import { RUNTIME_SOURCE } from "@orrery-diagrams/runtime";
import type * as Raster from "@orrery-diagrams/raster"; // the types only: the package is loaded when a PNG or GIF is asked for

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
                 [--png | --gif]         For where an SVG is not taken (a chat, a wiki, a forum): -o <out.png> or
                 [--scale <n>]           --png writes the picture at rest as a PNG; -o <out.gif> or --gif writes
                 [--fps <n>]             one loop of it as an animated GIF: flow, a playing scenario, a tour.
                 [--duration <seconds>]  Both draw what --static draws, on white, with their own fonts: same
                                         model, same bytes. --scale: pixels per unit (default 2). --fps: frames
                                         a second (default 10, at most 50). The loop is the scenario's or tour's
                                         whole cycle, else a few seconds in which every flow completes whole
                                         cycles, each period nudged to fit; --duration sets it instead.
  orrery export <file> [--out <dir>]     Write every entry of the model's "exports" to <dir>/<id>.svg: enclosed
                 [--png | --gif]         files, CSS animation only, no script. Default <dir> is the current
                 [--scale <n>]           directory. Prints one line per file. --png writes each as <id>.png and
                 [--fps <n>]             --gif as <id>.gif instead, as render does, with the same options.
                 [--duration <seconds>]
  orrery embed <file> [--out <dir>]      Write an embeddable diagram for a web page: <name>.svg (every topology
                                         view and drill-down, the model, the engine), <name>.<view>.svg for each
                                         sequence view, orrery.js (the engine, defining window.Orrery), and a
                                         sample index.html and app.js that build controls from the engine's
                                         interface. Replace the sample with your own page.
  orrery packs [<name>]                  List the vocabulary packs (sre: states, with the tool; aws, azure, gcp:
                                         the providers' icons as kinds, each its own package under the provider's
                                         terms, installed or not), or one pack's names with their descriptions.
                                         A model pulls a pack in with "kinds": { "use": ["aws"] } or "states":
                                         { "use": "sre" } and then names kinds like aws:s3.
  orrery --help                          This. orrery --version prints the version. A <file> of - reads the model
                                         from stdin. The command is also installed as orrery-diagrams.

Exit codes: 0 ok, 1 invalid or unreadable input, 2 usage error.
Layout is automatic; the file never contains coordinates. Every property is documented in the schema
(packages/core/schema/v1.json) and the model is specified in docs/MODEL.md.`;

/** The package's own version, read beside the built file. */
const VERSION: string = (JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")) as { version: string }).version;

export class CliError extends Error {
  constructor(message: string, public readonly exitCode: number = 1) { super(message); }
}
interface Io { stdout(s: string | Uint8Array): void; stderr(s: string): void }
type Raster = typeof Raster;

const VALUE_FLAGS = new Set(["-o", "--view", "--scenario", "--step", "--set", "--play", "--every", "--open", "--zoom", "--out", "--scale", "--fps", "--duration"]);
/** Flags whose value may be omitted (then the model's own declaration is used). */
const OPTIONAL_VALUE_FLAGS = new Set(["--tour", "--heading"]);
const BOOL_FLAGS = new Set(["--static", "--png", "--gif"]);
const PICTURE_FLAGS = new Set(["--png", "--gif", "--scale", "--fps", "--duration"]);

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
    else if (t.startsWith("-") && t !== "-") throw new CliError(`unknown option ${t}`, 2);
    else args.positionals.push(t); // "-" is a file: stdin
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

/** What a picture is written as: the SVG itself, or a raster of it (R19). */
interface Picture { format: "svg" | "png" | "gif"; scale: number; fps: number; durationMs?: number }

/** --png and --gif, or the extension of the file -o names; then the options that belong to a raster. */
function pictureOf(args: Args, out: string | undefined): Picture {
  if (args.flags.has("--png") && args.flags.has("--gif")) throw new CliError("choose one of --png and --gif", 2);
  const flag = args.flags.has("--png") ? "png" : args.flags.has("--gif") ? "gif" : undefined;
  const named = out?.match(/\.(svg|png|gif)$/i)?.[1]!.toLowerCase() as Picture["format"] | undefined;
  if (flag && named && named !== flag) throw new CliError(`-o ${out} names a .${named} file, but --${flag} writes a ${flag.toUpperCase()}`, 2);
  const format = flag ?? named ?? "svg";
  const number = (name: string, ok: (n: number) => boolean, expects: string) => {
    const raw = one(args, name);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!ok(n)) throw new CliError(`${name} must be ${expects}, got "${raw}"`, 2);
    return n;
  };
  const scale = number("--scale", (n) => n > 0 && n <= 8, "a number above 0 and at most 8");
  const fps = number("--fps", (n) => n >= 1 && n <= 50, "a number from 1 to 50");
  const duration = number("--duration", (n) => n > 0 && n <= 600, "a positive number of seconds, at most 600");
  if (scale !== undefined && format === "svg") throw new CliError("--scale is for a PNG or a GIF (-o <file>.png, --png, -o <file>.gif, --gif); an SVG has no pixels", 2);
  if (format !== "gif") for (const name of ["--fps", "--duration"]) if (args.values.has(name)) throw new CliError(`${name} is for a GIF (-o <file>.gif or --gif)`, 2);
  return { format, scale: scale ?? 2, fps: fps ?? 10, ...(duration !== undefined ? { durationMs: duration * 1000 } : {}) };
}

/**
 * The bytes of a picture in its format. The rasteriser (resvg, a native binary, and the fonts) is loaded only
 * here, so the commands that write SVG never wait for it and still work where it cannot be loaded.
 */
async function encode(svg: string, picture: Picture, load: () => Promise<Raster>): Promise<string | Uint8Array> {
  if (picture.format === "svg") return svg;
  let raster: Raster;
  try { raster = await load(); } catch (e) {
    throw new CliError(`PNG and GIF output needs @orrery-diagrams/raster, which could not be loaded: ${(e as Error).message}\nIt is installed with orrery-diagrams; if this platform has no build of it, write the SVG instead.`);
  }
  return picture.format === "png"
    ? raster.renderPng(svg, { scale: picture.scale })
    : raster.renderGif(svg, { scale: picture.scale, fps: picture.fps, ...(picture.durationMs !== undefined ? { durationMs: picture.durationMs } : {}) });
}

function loadModel(file: string, io: Io) {
  let text: string;
  if (file === "-") file = "stdin";
  try { text = readFileSync(file === "stdin" ? 0 : file, "utf8"); } catch (e) { throw new CliError(`${file}: ${(e as Error).message}`); }
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
  if (name === undefined) {
    const installed = packNames();
    const names = [...new Set([...installed, ...Object.keys(PROVIDER_PACKS)])].sort();
    const rows = names.map((n): [string, string] => {
      const info = PROVIDER_PACKS[n];
      if (!installed.includes(n)) return [n, `${info!.title}  not installed: add ${info!.package}`];
      const p = loadPack(n)!;
      return [n, `${p.title} (${p.version})  ${info ? info.package : "with the tool"}`];
    });
    return table(rows);
  }
  const pack = loadPack(name);
  if (!pack) throw new CliError(packProblem(name) ?? installHint(name));
  const sections: [string, [string, string][]][] = [["states", Object.entries(pack.states?.define ?? {}).map(([k, d]) => [k, d.description ?? ""])]];
  for (const section of ["components", "groups", "connections"] as const) sections.push([`kinds.${section}`, Object.entries(pack.kinds?.[section] ?? {}).map(([k, d]) => [`${name}:${k}`, d.description ?? ""])]);
  return `${pack.title} (${pack.version}), ${pack.source}\n${pack.terms}\n` + sections.filter(([, rows]) => rows.length).map(([title, rows]) => `\n${title}\n${table(rows)}`).join("");
}

/** Run the CLI. Returns the process exit code; never calls process.exit itself so it stays testable. */
export async function main(argv: string[], io: Io, loadRaster: () => Promise<Raster> = () => import("@orrery-diagrams/raster")): Promise<number> {
  const [command, ...rest] = argv;
  if (rest.includes("--help") || rest.includes("-h") || command === "--help" || command === "-h" || command === "help") { io.stdout(USAGE + "\n"); return 0; }
  if (command === "--version" || command === "-v" || command === "version") { io.stdout(`orrery ${VERSION}\n`); return 0; }
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
      const name = file === "-" ? "model" : basename(file).replace(/\.orrery\.json$|\.json$/, "");
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
      for (const flag of [...args.values.keys(), ...args.flags]) if (flag !== "--out" && !PICTURE_FLAGS.has(flag)) throw new CliError(`export takes --out and the PNG and GIF options, not ${flag}`, 2);
      const picture = pictureOf(args, undefined);
      const m = loadModel(file, io);
      if (!m.exports.length) throw new CliError(`${file}: the model declares no exports; add an "exports" list (docs/MODEL.md 4.9)`);
      try { mkdirSync(dir, { recursive: true }); } catch (e) { throw new CliError(`${dir}: ${(e as Error).message}`); }
      for (const x of m.exports) {
        const target = join(dir, `${x.id}.${picture.format}`);
        let svg: string;
        try { svg = await renderExport(m, new ElkLayoutEngine(), x); } catch (e) { if (e instanceof ModelError) throw new CliError(`${file}: export "${x.id}": ${e.message}`); throw e; }
        try { writeFileSync(target, await encode(svg, picture, loadRaster)); } catch (e) { throw new CliError(`${target}: ${(e as Error).message}`); }
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
    const picture = pictureOf(args, out);
    const isStatic = args.flags.has("--static") || picture.format !== "svg" || scenario !== undefined || tour !== undefined || open !== undefined || zoom !== undefined;
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
    const bytes = await encode(svg, picture, loadRaster);
    if (out !== undefined) {
      try { writeFileSync(out, bytes); } catch (e) { throw new CliError(`${out}: ${(e as Error).message}`); }
    } else io.stdout(bytes);
    return 0;
  } catch (e) {
    if (e instanceof CliError) { io.stderr(e.message + "\n"); return e.exitCode; }
    throw e;
  }
}
