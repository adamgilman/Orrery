// The moving parts page (examples/moving-parts/README.md) draws views, drill-down, scenarios, play and the tour from
// the checkout. Its model is derived from the master, examples/checkout.orrery.json, with more views, a second
// scenario step and the exports the page shows, so it cannot drift from the README's system. Usage: node tools/moving-parts.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const master = JSON.parse(readFileSync("examples/checkout.orrery.json", "utf8"));
const { $schema, direction, kinds, groups, components, connections, views, scenarios, tour } = master;
const dbFails = scenarios.find((s) => s.id === "db-fails");
const model = {
  $schema, title: "Checkout: the moving parts", direction, kinds, groups, components, connections,
  views: [
    ...views,
    { id: "front", title: "The front door", only: ["web", "api"] },
    { id: "all", title: "Everything open", direction: "down" },
  ],
  scenarios: [
    { ...dbFails, steps: [
      ...dbFails.steps,
      { note: "The primary is back; queued writes replay", restore: ["db", "web"], set: { degraded: { api: "replaying queued writes" } }, load: [{ id: "failover", load: 0 }] },
      { note: "Recovered", restore: ["api"] },
    ] },
    ...scenarios.filter((s) => s.id !== "db-fails"),
  ],
  tour,
  exports: [
    { id: "view-overview", view: "overview" }, { id: "view-data", view: "data" }, { id: "view-only", view: "front" }, { id: "view-all", view: "all" },
    { id: "open-sessions", open: ["sessions"] }, { id: "open-deep", open: ["sessions", "cache-a"] }, { id: "zoom-db", zoom: "db" }, { id: "open-and-zoom", open: ["sessions"], zoom: "sessions" },
    { id: "step-1", scenario: "db-fails", step: 1 }, { id: "step-2", scenario: "db-fails", step: 2 }, { id: "step-3", scenario: "db-fails", step: 3 },
    { id: "what-if", set: { off: { replica: "out for maintenance" }, degraded: { api: "no failover while the replica is out" } } },
    { id: "play", play: "db-fails", seconds: 3 },
    { id: "tour", tour: true },
  ],
};
mkdirSync("examples/moving-parts", { recursive: true });
writeFileSync("examples/moving-parts/moving-parts.orrery.json", JSON.stringify(model, null, 2) + "\n");
console.log("examples/moving-parts/moving-parts.orrery.json written");
