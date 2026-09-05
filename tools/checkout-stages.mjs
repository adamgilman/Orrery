// The README tells one story: a checkout system built up a stage at a time. Every stage is derived from the master
// model, examples/checkout.orrery.json, so the stages can never drift apart. Usage: node tools/checkout-stages.mjs
import { readFileSync, writeFileSync } from "node:fs";
const master = JSON.parse(readFileSync("examples/checkout.orrery.json", "utf8"));
const { $schema, direction, groups, components, connections, views, scenarios, tour } = master;
const bare = (c) => { const { group, ...rest } = c; return rest; };
const stages = {
  "1-parts": { title: "Checkout: the parts", direction: "right", components: components.map(bare) },
  "2-groups": { title: "Checkout: grouped", direction: "right", groups, components },
  "3-connections": { title: "Checkout: connected", direction, groups, components, connections },
  "4-scenarios": { title: "Checkout: what happens", direction, groups, components, connections, scenarios: scenarios.filter((s) => s.id === "db-fails") },
  "5-views": { title: "Checkout: views", direction, groups, components, connections, scenarios,
    views: views.map(({ collapse, ...v }) => v) },
  "6-drill-down": { title: "Checkout: drill down", direction, groups, components, connections, scenarios, views, tour },
  // The same system in one company's words. The session cache is a nice-to-have for this team: drained for
  // maintenance, checkout runs on for guests, a brownout. Nothing in the tool knows these names.
  "7-vocabulary": {
    title: "Checkout, in our words", direction, groups,
    states: {
      replace: true, default: "healthy",
      define: {
        healthy: { look: "normal", description: "Within SLO" },
        impaired: { look: "warn", description: "Serving; redundancy or latency SLO breached" },
        brownout: { look: { stroke: "#7c3aed", fill: "#f5f3ff", text: "#5b21b6", pulse: true }, description: "Serving with a feature switched off" },
        outage: { look: "alert", flows: "stop", description: "Customer-visible failure" },
        drained: { look: "muted", flows: "stop", description: "Deliberately out of rotation" },
      },
    },
    components, connections,
    scenarios: [{ id: "cache-maintenance", label: "Session cache maintenance", steps: [{
      note: "The cache cluster is drained: checkout continues for guests",
      set: { drained: ["sessions", "cache-a", "cache-b"], brownout: { api: "guest checkout only: no saved carts" }, impaired: { web: "signed-in customers check out as guests" } },
    }] }],
  },
};
for (const [name, stage] of Object.entries(stages)) writeFileSync(`examples/checkout/${name}.orrery.json`, JSON.stringify({ $schema, ...stage }, null, 2) + "\n");
console.log(`${Object.keys(stages).length} stages written to examples/checkout/`);
