// The README tells one story: a checkout system built up a stage at a time. Every stage is derived from the master
// model, examples/checkout.orrery.json, so the stages can never drift apart. Usage: node tools/checkout-stages.mjs
import { readFileSync, writeFileSync } from "node:fs";
const master = JSON.parse(readFileSync("examples/checkout.orrery.json", "utf8"));
const { $schema, direction, groups, components, connections, views, scenarios, tour } = master;
const bare = (c) => { const { group, ...rest } = c; return rest; };
// Before the drill-down stage the session cache is one closed box. Stage 1 has no groups yet, so it is one part.
const topLevel = (c) => !["cache-a", "cache-b"].includes(c.group);
const parts = [...components.filter(topLevel).map(bare), { id: "sessions", label: "Session cache", kind: "cache" }];
const closedViews = [{ id: "overview", title: "Overview", collapse: ["sessions"] }, { id: "data", title: "Data tier", scope: "data", direction: "down", collapse: ["sessions"] }];
const stages = {
  "1-parts": { title: "Checkout: the parts", direction: "right", components: parts, exports: [{ id: "1-parts" }] },
  "2-groups": { title: "Checkout: grouped", direction: "right", groups, components, views: [closedViews[0]], exports: [{ id: "2-groups" }] },
  "3-connections": { title: "Checkout: connected", direction, groups, components, connections, views: [closedViews[0]], exports: [{ id: "3-connections" }] },
  "4-scenarios": { title: "Checkout: what happens", direction, groups, components, connections, scenarios: scenarios.filter((s) => s.id === "db-fails"), views: [closedViews[0]],
    exports: [{ id: "4-scenarios-failed", scenario: "db-fails", step: 1 }, { id: "4-scenarios-play", play: "db-fails", seconds: 3 }] },
  "5-views": { title: "Checkout: views", direction, groups, components, connections, scenarios, views: closedViews,
    exports: [{ id: "5-views-overview", view: "overview" }, { id: "5-views-data", view: "data" }] },
  "6-drill-down": { title: "Checkout: drill down", direction, groups, components, connections, scenarios, views, tour,
    exports: [{ id: "6-drill-down" }, { id: "6-drill-down-inside", open: ["sessions", "cache-a"], zoom: "cache-a" }, { id: "6-drill-down-tour", tour: true }] },
  // The same system in one company's words. The session cache is a nice-to-have for this team: drained for
  // maintenance, checkout runs on for guests, a brownout. Nothing in the tool knows these names.
  "7-vocabulary": {
    title: "Checkout, in our words", direction, groups, views: [closedViews[0]],
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
    exports: [{ id: "7-vocabulary-play", play: "cache-maintenance", seconds: 4 }],
    scenarios: [{ id: "cache-maintenance", label: "Session cache maintenance", steps: [{
      note: "The cache cluster is drained: checkout continues for guests",
      set: { drained: ["sessions", "cache-a", "cache-b", "redis-a", "aof-a", "redis-b", "aof-b"], brownout: { api: "guest checkout only: no saved carts" }, impaired: { web: "signed-in customers check out as guests" } },
    }] }],
  },
  // The same checkout on AWS: kinds from the aws pack, so the boxes carry the provider's own icons.
  "8-cloud": {
    title: "Checkout on AWS", direction, kinds: { use: ["aws"] },
    groups: groups.map((g) => (g.id === "data" ? { ...g, kind: "aws:private-subnet" } : g)),
    components: components.map((c) => ({ ...c, kind: { api: "aws:fargate", db: "aws:rds", replica: "aws:rds", "redis-a": "aws:elasticache", "redis-b": "aws:elasticache", "aof-a": "aws:s3", "aof-b": "aws:s3" }[c.id] ?? c.kind })),
    connections, views: [closedViews[0]], exports: [{ id: "8-cloud" }],
  },
};
for (const [name, stage] of Object.entries(stages)) writeFileSync(`examples/checkout/${name}.orrery.json`, JSON.stringify({ $schema, ...stage }, null, 2) + "\n");
console.log(`${Object.keys(stages).length} stages written to examples/checkout/`);
