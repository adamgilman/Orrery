// Re-render every example. Usage: yarn examples
// The README and the landing page tell one story, a checkout system built up a stage at a time: tools/checkout-stages.mjs
// derives examples/checkout/*.orrery.json from examples/checkout.orrery.json, and every picture is one of a file's own
// `exports`, written by `orrery export`. The two interactive files are rendered whole.
import { execFileSync } from "node:child_process";
import { copyFileSync, readdirSync } from "node:fs";
const cli = "packages/cli/dist/main.js";
const run = (...args) => execFileSync("node", [cli, ...args], { encoding: "utf8" });
execFileSync("node", ["tools/checkout-stages.mjs"], { stdio: "inherit" });
run("render", "examples/solar-system.orrery.json", "-o", "examples/solar-system.svg");
run("render", "examples/checkout.orrery.json", "-o", "examples/checkout.svg"); // the interactive file the README and landing page link to
for (const f of ["examples/checkout.orrery.json", ...readdirSync("examples/checkout").filter((f) => f.endsWith(".orrery.json")).map((f) => `examples/checkout/${f}`)]) {
  for (const line of run("export", f, "--out", "examples/checkout").trim().split("\n")) console.log(line);
}
// the kitchen sink: every variant of the vocabulary, one file per block (examples/kitchen-sink/README.md)
for (const f of readdirSync("examples/kitchen-sink").filter((f) => f.endsWith(".orrery.json"))) {
  for (const line of run("export", `examples/kitchen-sink/${f}`, "--out", "examples/kitchen-sink").trim().split("\n")) console.log(line);
}
// the moving parts: views, drill-down, scenarios, play and the tour, derived from the checkout master (examples/moving-parts/README.md)
execFileSync("node", ["tools/moving-parts.mjs"], { stdio: "inherit" });
for (const line of run("export", "examples/moving-parts/moving-parts.orrery.json", "--out", "examples/moving-parts").trim().split("\n")) console.log(line);
// the landing page inlines these
run("render", "examples/solar-system.orrery.json", "--static", "-o", "site/landing/solar.svg");
for (const [from, to] of [["4-scenarios-play", "failover-play"], ["7-vocabulary-play", "vocabulary-play"], ["5-views-data", "data-view"], ["6-drill-down-tour", "drill-down-tour"]]) copyFileSync(`examples/checkout/${from}.svg`, `site/landing/${to}.svg`);
for (const [from, to] of [["kitchen-sink/shapes-1", "shapes"], ["kitchen-sink/packs-aws", "packs-aws"]]) copyFileSync(`examples/${from}.svg`, `site/landing/${to}.svg`);
