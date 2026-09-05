// ELK option sweep over the compound examples, scored by tools/layout-score.mjs. Usage: node tools/layout-tune.mjs
import { readFileSync } from "node:fs";
import { validate, toLayoutGraph, scopeModel, selectView } from "@orrery/core";
import { ElkLayoutEngine } from "@orrery/layout-elk";
import { score } from "./layout-score.mjs";
const files = ["examples/checkout.orrery.json", "examples/agent-test-2.orrery.json", "examples/three-tier.orrery.json"];
const graphs = files.map((f) => { const d = validate(JSON.parse(readFileSync(f, "utf8"))).model; return toLayoutGraph(scopeModel(d, selectView(d))); });
const variants = {
  "baseline": {},
  "favorStraightEdges": { "elk.layered.nodePlacement.favorStraightEdges": "true" },
  "thoroughness 20": { "elk.layered.thoroughness": "20" },
  "no separate components": { "elk.separateConnectedComponents": "false" },
  "edgeNode 40": { "elk.spacing.edgeNode": "40", "elk.layered.spacing.edgeNodeBetweenLayers": "40" },
  "postCompaction EDGE_LENGTH": { "elk.layered.compaction.postCompaction.strategy": "EDGE_LENGTH" },
  "unnecessaryBendpoints": { "elk.layered.unnecessaryBendpoints": "true" },
  "hierarchicalSweepiness 1": { "elk.layered.crossingMinimization.hierarchicalSweepiness": "1" },
  "hierarchicalSweepiness -1": { "elk.layered.crossingMinimization.hierarchicalSweepiness": "-1" },
  "cycleBreaking MODEL_ORDER": { "elk.layered.cycleBreaking.strategy": "MODEL_ORDER" },
  "layering LONGEST_PATH": { "elk.layered.layering.strategy": "LONGEST_PATH" },
  "nodePlacement NETWORK_SIMPLEX": { "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX" },
  "nodePlacement LINEAR_SEGMENTS": { "elk.layered.nodePlacement.strategy": "LINEAR_SEGMENTS" },
  "componentComponent 60": { "elk.spacing.componentComponent": "60" },
  "edgeEdge 25 / edgeEdgeBetweenLayers 25": { "elk.spacing.edgeEdge": "25", "elk.layered.spacing.edgeEdgeBetweenLayers": "25" },
};
for (const [name, extra] of Object.entries(variants)) {
  const cols = [];
  for (const g of graphs) {
    try { const s = score(g, await new ElkLayoutEngine({ extra }).layout(g)); cols.push(`b${s.bends} L${s.length} n${s.throughNodes} f${s.frameCrossings} ${s.w}x${s.h}`); }
    catch { cols.push("CRASH"); }
  }
  console.log(name.padEnd(40), cols.map((c) => c.padEnd(30)).join(""));
}
