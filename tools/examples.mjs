// Re-render every example (and the fan-out fixture) to examples/*.svg. Usage: yarn examples
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
const cli = "packages/cli/dist/main.js";
const jobs = readdirSync("examples").filter((f) => f.endsWith(".orrery.json")).map((f) => [`examples/${f}`, `examples/${f.replace(/\.orrery\.json$/, ".svg")}`]);
jobs.push(["fixtures/valid/fan-out.json", "examples/fan-out.svg"]);
for (const [src, out] of jobs) { execFileSync("node", [cli, "render", src, "-o", out], { stdio: "inherit" }); console.log(`${src} -> ${out}`); }
