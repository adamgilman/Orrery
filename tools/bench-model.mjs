// Writes test/perf/benchmark.orrery.json once: a frozen model of fixed size for the performance ratchet. It is
// deliberately not a real system and deliberately never edited for features; the ratchet measures the tool, so the
// input must stay the same. Regenerate only if the schema forces it, and say so in test/perf/README.md.
// Usage: node tools/bench-model.mjs
import { writeFileSync } from "node:fs";
const regions = ["eu", "us", "ap"], tiers = ["edge", "app", "data"];
const kinds = { edge: ["gateway", "service", "cache"], app: ["service", "service", "function", "queue"], data: ["database", "database", "storage", "cache"] };
const groups = [], components = [], connections = [];
for (const r of regions) {
  groups.push({ id: r, label: `Region ${r.toUpperCase()}`, kind: "region" });
  for (const t of tiers) {
    groups.push({ id: `${r}-${t}`, label: `${t} tier`, kind: "tier", parent: r });
    kinds[t].forEach((kind, i) => components.push({ id: `${r}-${t}-${i}`, label: `${t} ${i + 1}`, kind, group: `${r}-${t}`, tech: `${kind} v${i + 1}`, ...(i === 0 ? { replicas: 3 } : {}) }));
  }
  // within a region: edge → app → data, a few cross links, a replication pair
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) connections.push({ from: `${r}-edge-${i}`, to: `${r}-app-${j}`, load: 0.3 + 0.1 * j, ...(j === 0 ? { label: "https" } : {}) });
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i * j) % 3 === 0) connections.push({ from: `${r}-app-${i}`, to: `${r}-data-${j}`, load: 0.2 + 0.1 * i, kind: j === 3 ? "async" : "sync" });
  connections.push({ id: `${r}-repl`, from: `${r}-data-0`, to: `${r}-data-1`, kind: "replication", load: 0.2 });
  connections.push({ from: `${r}-data-2`, to: `${r}-data-3`, kind: "dataflow", load: 0.5, bidirectional: true, label: "sync" });
}
components.push({ id: "users", label: "Users", kind: "client" }, { id: "partner", label: "Partner API", kind: "external" });
for (const r of regions) connections.push({ from: "users", to: `${r}-edge-0`, load: 0.6 }, { from: `${r}-app-1`, to: "partner", load: 0.2, kind: "async" });
connections.push({ id: "eu-us", from: "eu-data-0", to: "us-data-0", kind: "replication", load: 0.1, label: "cross-region" });
const model = {
  $schema: "../../packages/core/schema/v1.json",
  title: "Benchmark: three regions, three tiers",
  description: "A frozen model of fixed size for the performance ratchet. Not a real system.",
  direction: "right",
  groups, components, connections,
  callouts: [{ at: "eu-us", text: "Cross-region replication, the slow path" }],
  views: [
    { id: "overview", title: "Overview", collapse: regions.map((r) => `${r}-app`) },
    { id: "eu", title: "EU", scope: "eu", direction: "down" },
    { id: "data", title: "Data", only: regions.map((r) => `${r}-data`) },
  ],
  scenarios: [
    { id: "eu-down", label: "EU region fails", steps: [
      { note: "EU primary database fails", set: { failed: { "eu-data-0": "disk full" }, degraded: ["eu-app-0", "eu-app-1"] }, load: [{ id: "eu-repl", load: 0 }], callouts: [{ at: "eu-data-0", text: "Writes fail over to the replica" }] },
      { note: "EU drained; US takes the traffic", set: { off: ["eu-edge-0", "eu-edge-1", "eu-edge-2"], degraded: ["us-app-0"] }, load: [{ from: "users", to: "eu-edge-0", load: 0 }, { from: "users", to: "us-edge-0", load: 1 }] },
      { note: "Recovered", restore: ["eu-data-0", "eu-app-0", "eu-app-1", "eu-edge-0", "eu-edge-1", "eu-edge-2", "us-app-0"], load: [{ id: "eu-repl", load: 0.2 }, { from: "users", to: "eu-edge-0", load: 0.6 }, { from: "users", to: "us-edge-0", load: 0.6 }] },
    ] },
  ],
  tour: { seconds: 4, scenes: [
    { view: "overview", note: "Three regions, closed" },
    { view: "overview", open: ["eu-app"], note: "Inside the EU app tier" },
    { view: "overview", open: ["eu-app", "us-app"], zoom: "us-app", note: "The US app tier" },
    { view: "overview", scenario: "eu-down", step: 2, note: "EU drained" },
    { view: "overview", note: "Recovered" },
  ] },
  exports: [{ id: "overview" }, { id: "eu", view: "eu" }, { id: "open", open: ["eu-app", "us-app"] }, { id: "failed", scenario: "eu-down", step: 1 }, { id: "play", play: "eu-down" }, { id: "tour", tour: true }],
};
writeFileSync("test/perf/benchmark.orrery.json", JSON.stringify(model, null, 2) + "\n");
console.log(`benchmark: ${components.length} components, ${connections.length} connections, ${groups.length} groups`);
