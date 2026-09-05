import { readFileSync, writeFileSync } from "node:fs";
import { render, renderDocument, validate, type ValidationError } from "@orrery/core";
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
                                         --static; --step <n> stops after step n (default: the last step).
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

function loadModel(file: string, io: Io) {
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch (e) { throw new CliError(`${file}: ${(e as Error).message}`); }
  let json: unknown;
  try { json = JSON.parse(text); } catch (e) { throw new CliError(`${file}: invalid JSON: ${(e as Error).message}`); }
  const result = validate(json);
  if (!result.ok) throw new CliError(formatErrors(file, result.errors));
  for (const w of result.warnings) io.stderr(`${file}:${w.toString()} (warning)\n`);
  return result.model;
}

/** --set failed=db,cache --set off=eu → { failed: [db, cache], off: [eu] } */
function parseSets(rest: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  rest.forEach((a, i) => {
    if (a !== "--set") return;
    const v = rest[i + 1];
    const m = v?.match(/^([A-Za-z][A-Za-z0-9_-]*)=(.+)$/);
    if (!m) throw new CliError(`--set expects <state>=<id>[,<id>...], got "${v ?? ""}"`, 2);
    out[m[1]!] = [...(out[m[1]!] ?? []), ...m[2]!.split(",").map((x) => x.trim()).filter(Boolean)];
  });
  return out;
}

const formatErrors = (file: string, errors: ValidationError[]) => errors.map((e) => `${file}:${e.toString()}`).join("\n");

/** Run the CLI. Returns the process exit code; never calls process.exit itself so it stays testable. */
export async function main(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;
  if (rest.includes("--help") || rest.includes("-h")) { io.stdout(USAGE + "\n"); return 0; }
  try {
    switch (command) {
      case "--help": case "-h": case "help":
        io.stdout(USAGE + "\n"); return 0;
      case "validate": {
        const file = rest[0];
        if (!file) throw new CliError(USAGE, 2);
        const m = loadModel(file, io);
        io.stdout(`OK: ${m.components.length} components, ${m.connections.length} connections, ${m.groups.length} groups, ${m.views.length} views${m.scenarios.length ? `, ${m.scenarios.length} scenarios` : ""}\n`);
        return 0;
      }
      case "render": {
        const file = rest[0];
        if (!file) throw new CliError(USAGE, 2);
        const flag = (name: string) => { const i = rest.indexOf(name); if (i < 0) return undefined; const v = rest[i + 1]; if (!v) throw new CliError(`${name} requires a value`, 2); return v; };
        const out = flag("-o");
        const view = flag("--view");
        const scenario = flag("--scenario");
        const stepRaw = flag("--step");
        if (stepRaw !== undefined && scenario === undefined) throw new CliError("--step requires --scenario", 2);
        const step = stepRaw !== undefined ? Number(stepRaw) : undefined;
        if (step !== undefined && !Number.isInteger(step)) throw new CliError(`--step must be an integer, got "${stepRaw}"`, 2);
        const isStatic = rest.includes("--static") || scenario !== undefined;
        const set = parseSets(rest);
        const hasSet = Object.keys(set).length > 0;
        const model = loadModel(file, io);
        let svg: string;
        try {
          svg = isStatic
            ? await render(model, new ElkLayoutEngine(), {
                ...(view !== undefined ? { view } : {}), ...(scenario !== undefined ? { scenario } : {}), ...(step !== undefined ? { step } : {}), ...(hasSet ? { set } : {}),
              })
            : await renderDocument(model, new ElkLayoutEngine(), { runtime: RUNTIME_SOURCE, ...(view !== undefined ? { view } : {}), ...(hasSet ? { set } : {}) });
        } catch (e) {
          if (e instanceof Error && /^(unknown view|unknown scenario|unknown state|unknown entity|scenario ")/.test(e.message)) throw new CliError(`${file}: ${e.message}`);
          throw e;
        }
        if (out) writeFileSync(out, svg); else io.stdout(svg);
        return 0;
      }
      default:
        throw new CliError(USAGE, 2);
    }
  } catch (e) {
    if (e instanceof CliError) { io.stderr(e.message + "\n"); return e.exitCode; }
    throw e;
  }
}
