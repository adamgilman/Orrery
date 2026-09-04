import { readFileSync, writeFileSync } from "node:fs";
import { render, validate, type ValidationError } from "@orrery/core";
import { ElkLayoutEngine } from "@orrery/layout-elk";

export const USAGE = `Usage:
  orrery validate <file>                 Check a diagram file; prints one "<pointer>: <message>" per error
  orrery render <file> [-o <out.svg>]    Render an animated SVG (stdout when -o is omitted)
  orrery --help

Schema: https://orrery.dev/schema/v1.json`;

export class CliError extends Error {
  constructor(message: string, public readonly exitCode: number = 1) { super(message); }
}

interface Io { stdout(s: string): void; stderr(s: string): void }

function loadDiagram(file: string) {
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch (e) { throw new CliError(`${file}: ${(e as Error).message}`); }
  let json: unknown;
  try { json = JSON.parse(text); } catch (e) { throw new CliError(`${file}: invalid JSON: ${(e as Error).message}`); }
  const result = validate(json);
  if (!result.ok) throw new CliError(formatErrors(file, result.errors));
  return result.diagram;
}

const formatErrors = (file: string, errors: ValidationError[]) => errors.map((e) => `${file}:${e.toString()}`).join("\n");

/** Run the CLI. Returns the process exit code; never calls process.exit itself so it stays testable. */
export async function main(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "--help": case "-h": case "help":
        io.stdout(USAGE + "\n"); return 0;
      case "validate": {
        const file = rest[0];
        if (!file) throw new CliError(USAGE, 2);
        const d = loadDiagram(file);
        io.stdout(`OK: ${d.nodes.length} nodes, ${d.edges.length} edges\n`);
        return 0;
      }
      case "render": {
        const file = rest[0];
        if (!file) throw new CliError(USAGE, 2);
        const oIdx = rest.indexOf("-o");
        const out = oIdx >= 0 ? rest[oIdx + 1] : undefined;
        if (oIdx >= 0 && !out) throw new CliError("-o requires a path", 2);
        const svg = await render(loadDiagram(file), new ElkLayoutEngine());
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
