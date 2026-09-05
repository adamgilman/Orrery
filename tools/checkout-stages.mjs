// The README tells one story: a checkout system built up a stage at a time. Every stage is derived from the master
// model, examples/checkout.orrery.json, so the stages can never drift apart. Usage: node tools/checkout-stages.mjs
import { readFileSync, writeFileSync } from "node:fs";
const master = JSON.parse(readFileSync("examples/checkout.orrery.json", "utf8"));
const { $schema, direction, groups, components, connections, views, scenarios, tour } = master;
const bare = (c) => { const { group, needs, ...rest } = c; return rest; };
const withoutNeeds = (c) => { const { needs, ...rest } = c; return rest; };
const stages = {
  "1-parts": { title: "Checkout: the parts", direction: "right", components: components.map(bare) },
  "2-groups": { title: "Checkout: grouped", direction: "right", groups, components: components.map(withoutNeeds) },
  "3-connections": { title: "Checkout: connected", direction, groups, components: components.map(withoutNeeds), connections },
  "4-needs": { title: "Checkout: what needs what", direction, groups, components, connections, scenarios: scenarios.filter((s) => s.id === "db-fails") },
  "5-views": { title: "Checkout: views", direction, groups, components, connections, scenarios,
    views: views.map(({ collapse, ...v }) => v) },
  "6-drill-down": { title: "Checkout: drill down", direction, groups, components, connections, scenarios, views, tour },
  // The same system in one company's words. The session cache is a nice-to-have: without it, checkout still takes
  // orders as guests, a brownout. Nothing in the engine knows these names.
  "7-vocabulary": {
    title: "Checkout, in our words", direction, groups,
    states: {
      replace: true, default: "healthy", needs: { unmet: "outage", reduced: "impaired" },
      define: {
        healthy: { look: "normal", rank: 0, available: true, description: "Within SLO" },
        impaired: { look: "warn", rank: 1, available: true, description: "Serving; redundancy or latency SLO breached" },
        brownout: { look: { stroke: "#7c3aed", fill: "#f5f3ff", text: "#5b21b6", pulse: true }, rank: 1, available: true, description: "Serving with a feature switched off" },
        outage: { look: "alert", rank: 3, available: false, flows: "stop", description: "Customer-visible failure" },
        drained: { look: "muted", rank: 3, available: false, flows: "stop", cascade: "children", description: "Deliberately out of rotation" },
      },
    },
    components: components.map((c) => (c.id === "api" ? { ...c, needs: c.needs.map((n) => (n === "sessions" ? { any: ["sessions"], unmet: "brownout" } : n)) } : c)),
    connections,
    scenarios: [{ id: "cache-maintenance", label: "Session cache maintenance", steps: [{ note: "The cache cluster is drained: checkout continues for guests", set: { drained: "sessions" } }] }],
  },
};
for (const [name, stage] of Object.entries(stages)) writeFileSync(`examples/checkout/${name}.orrery.json`, JSON.stringify({ $schema, ...stage }, null, 2) + "\n");
console.log(`${Object.keys(stages).length} stages written to examples/checkout/`);
