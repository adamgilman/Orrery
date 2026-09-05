// Re-render every example to SVG. Usage: yarn examples
// examples/*.orrery.json render as-is; examples/readme/* follow the manifest below (views and scenario steps).
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
const cli = "packages/cli/dist/main.js";
const jobs = readdirSync("examples").filter((f) => f.endsWith(".orrery.json")).map((f) => [`examples/${f}`, [], `examples/${f.replace(/\.orrery\.json$/, ".svg")}`]);
jobs.push(["fixtures/valid/fan-out.json", [], "examples/fan-out.svg"]);
for (const f of readdirSync("examples/next").filter((f) => f.endsWith(".orrery.json"))) jobs.push([`examples/next/${f}`, [], `examples/next/${f.replace(/\.orrery\.json$/, ".svg")}`]);
jobs.push(["examples/next/4-own-vocabulary.orrery.json", ["--scenario", "quorum", "--step", "2"], "examples/next/4-own-vocabulary-quorum.svg"]);
jobs.push(["examples/checkout.orrery.json", ["--scenario", "db-failover", "--step", "2"], "examples/checkout-db-failover.svg"]);
jobs.push(["examples/checkout.orrery.json", ["--view", "data"], "examples/checkout-data.svg"]);
jobs.push(["examples/checkout.orrery.json", ["--view", "region"], "examples/checkout-region.svg"]);
const readme = {
  "kinds": [[]], "groups": [[]], "edge-kinds": [[]],
  "failover": [[], ["--scenario", "db-fails"]],
  "views": [["--view", "overview"], ["--view", "billing"]],
};
for (const [name, renders] of Object.entries(readme))
  renders.forEach((args, i) => jobs.push([`examples/readme/${name}.orrery.json`, args, `examples/readme/${name}${i ? `-${args.at(-1)}` : ""}.svg`]));
for (const [src, args, out] of jobs) {
  execFileSync("node", [cli, "render", src, ...args, "-o", out], { stdio: "inherit" });
  const size = execFileSync("grep", ["-o", 'viewBox="[^"]*"', out], { encoding: "utf8" }).trim();
  console.log(`${out.padEnd(44)} ${size}`);
}
