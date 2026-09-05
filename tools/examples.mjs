// Re-render every example to SVG. Usage: yarn examples
// The README and the landing page tell one story, a checkout system built up a stage at a time: tools/checkout-stages.mjs
// derives examples/checkout/*.orrery.json from examples/checkout.orrery.json, and the manifest below renders each stage.
import { execFileSync } from "node:child_process";
const cli = "packages/cli/dist/main.js";
execFileSync("node", ["tools/checkout-stages.mjs"], { stdio: "inherit" });
const jobs = [
  ["examples/solar-system.orrery.json", [], "examples/solar-system.svg"],
  ["examples/checkout.orrery.json", [], "examples/checkout.svg"], // the interactive file the README and landing page link to
  ["examples/checkout/1-parts.orrery.json", ["--static"], "examples/checkout/1-parts.svg"],
  ["examples/checkout/2-groups.orrery.json", ["--static"], "examples/checkout/2-groups.svg"],
  ["examples/checkout/3-connections.orrery.json", ["--static"], "examples/checkout/3-connections.svg"],
  ["examples/checkout/4-scenarios.orrery.json", ["--static", "--scenario", "db-fails"], "examples/checkout/4-scenarios-failed.svg"],
  ["examples/checkout/4-scenarios.orrery.json", ["--static", "--play", "db-fails", "--every", "3"], "examples/checkout/4-scenarios-play.svg"],
  ["examples/checkout/5-views.orrery.json", ["--static", "--view", "overview"], "examples/checkout/5-views-overview.svg"],
  ["examples/checkout/5-views.orrery.json", ["--static", "--view", "data"], "examples/checkout/5-views-data.svg"],
  ["examples/checkout/6-drill-down.orrery.json", ["--static"], "examples/checkout/6-drill-down.svg"],
  ["examples/checkout/6-drill-down.orrery.json", ["--tour"], "examples/checkout/6-drill-down-tour.svg"],
  ["examples/checkout/7-vocabulary.orrery.json", ["--static", "--play", "cache-maintenance", "--every", "4"], "examples/checkout/7-vocabulary-play.svg"],
  // static renders the landing page inlines
  ["examples/solar-system.orrery.json", ["--static"], "site/landing/solar.svg"],
  ["examples/checkout/4-scenarios.orrery.json", ["--static", "--play", "db-fails", "--every", "3"], "site/landing/failover-play.svg"],
  ["examples/checkout/7-vocabulary.orrery.json", ["--static", "--play", "cache-maintenance", "--every", "4"], "site/landing/vocabulary-play.svg"],
  ["examples/checkout/5-views.orrery.json", ["--static", "--view", "data"], "site/landing/data-view.svg"],
  ["examples/checkout/6-drill-down.orrery.json", ["--tour"], "site/landing/drill-down-tour.svg"],
];
for (const [src, args, out] of jobs) {
  execFileSync("node", [cli, "render", src, ...args, "-o", out], { stdio: "inherit" });
  const size = execFileSync("grep", ["-o", 'viewBox="[^"]*"', out], { encoding: "utf8" }).trim();
  console.log(`${out.padEnd(48)} ${size}`);
}
