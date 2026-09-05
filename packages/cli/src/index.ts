import { readFileSync, writeFileSync } from "node:fs";
import { ModelError, render, renderDocument, validate, type ValidationError } from "@orrery/core";
import { ElkLayoutEngine } from "@orrery/layout-elk";
import { RUNTIME_SOURCE } from "@orrery/runtime";

export const USAGE = `Usage:
  orrery validate <file>                 Check a model file. Prints "OK: N components, M connections, ...", plus any
                                         warnings; or one "<file>:<json-pointer>: <message>" line per error on stderr.
  orrery render <file> [-o <out.svg>]    Validate, lay out and render one standalone SVG. Inside <img> (a README)
                 [--view <id>]           it is the animated first view; opened directly in a browser it is
                 [--static]              interactive: every view is embedded with the model and a runtime
                 [--scenario <id>]       (outline, zoom, click to change state, scenarios). Deterministic.
                 [--step <n>]            --view: which view is shown first. --static: one view, no runtime.
                 [--set <state>=<ids>]   --scenario applies a scenario's steps (cumulative) and implies
                                         --static; --step <n> (1-based) stops after step n (default: last).
                                         --set failed=db,cache  declares states for a one-off what-if
                                         (repeatable; applied after the scenario).
  orrery --help

Exit codes: 0 ok, 1 invalid or unreadable input, 2 usage error.
Layout is automatic; the file never contains coordinates. Every property is documented in the schema
(packages/core/schema/v1.json) and the model is specified in docs/MODEL.md.`;

export class CliError extends Error {
  constructor(message: string, public readonly exitCode: number = 1) { super(message); }
}
interface Io { stdout(s: string): void; stderr(s: string): void }

const VALUE_FLAGS = new Set(["-o", "--view", "--scenario", "--step", "--set"]);
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

/** Run the CLI. Returns the process exit code; never calls process.exit itself so it stays testable. */
export async function main(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;
  if (rest.includes("--help") || rest.includes("-h") || command === "--help" || command === "-h" || command === "help") { io.stdout(USAGE + "\n"); return 0; }
  try {
    if (command !== "validate" && command !== "render") throw new CliError(USAGE, 2);
    const args = parseArgs(rest);
    const [file, ...extra] = args.positionals;
    if (!file) throw new CliError(USAGE, 2);
    if (extra.length) throw new CliError(`unexpected argument ${extra[0]}`, 2);
    if (command === "validate") {
      if (args.values.size || args.flags.size) throw new CliError("validate takes no options", 2);
      const m = loadModel(file, io);
      io.stdout(`OK: ${m.components.length} components, ${m.connections.length} connections, ${m.groups.length} groups, ${m.views.length} views${m.scenarios.length ? `, ${m.scenarios.length} scenarios` : ""}\n`);
      return 0;
    }
    const out = one(args, "-o"), view = one(args, "--view"), scenario = one(args, "--scenario"), stepRaw = one(args, "--step");
    if (stepRaw !== undefined && scenario === undefined) throw new CliError("--step requires --scenario", 2);
    const step = stepRaw !== undefined ? Number(stepRaw) : undefined;
    if (step !== undefined && !Number.isInteger(step)) throw new CliError(`--step must be an integer, got "${stepRaw}"`, 2);
    const set = parseSets(args.values.get("--set"));
    const hasSet = Object.keys(set).length > 0;
    const isStatic = args.flags.has("--static") || scenario !== undefined;
    const model = loadModel(file, io);
    let svg: string;
    try {
      const common = { ...(view !== undefined ? { view } : {}), ...(hasSet ? { set } : {}) };
      svg = isStatic
        ? await render(model, new ElkLayoutEngine(), { ...common, ...(scenario !== undefined ? { scenario } : {}), ...(step !== undefined ? { step } : {}) })
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
