// Generates the parts of the Claude Code skill (plugins/orrery/skills/orrery-diagrams/references) that come straight
// from the repository, so the skill cannot drift from the tool: the field tables from docs/MODEL.md, the worked
// examples from the checkout stages, and the error catalogue from the invalid fixtures. Usage: node tools/skill-refs.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
const out = "plugins/orrery/skills/orrery-diagrams/references";
const spec = readFileSync("docs/MODEL.md", "utf8");
const section = (from, to) => spec.slice(spec.indexOf(`\n${from}`), spec.indexOf(`\n${to}`)).trim();

// ---- model.md: sections 4.1 to 4.10 of the specification, verbatim, with a header that says so
const body = section("### 4.1 Document", "## 5. Semantics").replace(/\(R(\d+)\)|\(S(\d+)\)/g, (m) => m); // invariant numbers stay: they name tests in MODEL.md
writeFileSync(`${out}/model.md`, `# The model, field by field

Generated from docs/MODEL.md §4 by tools/skill-refs.mjs; edit the specification, not this file. Invariant numbers
(R…, S…) name the rules and tests in the specification. Every field here is also described in the JSON Schema.

${body}
`);

// ---- examples.md: the README's checkout, stage by stage, each a complete valid file
const stages = readdirSync("examples/checkout").filter((f) => f.endsWith(".orrery.json")).sort();
const stageNotes = {
  "1-parts": "Components alone render. Each has a kind; the defaults draw a client as a pill, a database as a cylinder. `kinds.use` pulls in the AWS pack so `aws:fargate` and `aws:rds` carry the provider's icons.",
  "2-groups": "Groups are containers that mean something, nested as deep as the system goes. The view draws the session cache closed: one box the size of a component.",
  "3-connections": "Connections are directed, drawn by their kind's line, animated by `load`. A connection may end on a group; the failover line carries no load yet.",
  "4-scenarios": "A scenario is cumulative steps. This one fails the primary, degrades two components with reasons, moves the failover load, and points at the replica with a callout. Two exports: a still of step 1, and the scenario playing on a loop.",
  "5-views": "One model, two drawings: the overview, and the data tier scoped and laid out downwards. What lies outside a scoped view is a ghost.",
  "6-drill-down": "Closed groups nest. The tour opens the cache, opens both nodes, zooms into node A, fails Redis, zooms out, closes everything: one drawing that moves.",
  "8-sequence": "A sequence view: the messages of one request, in order, over connections the model already declares (a message with no connection under it is an error). Each participant is its own box on a lifeline, in its state; `reply: true` is the dashed return; `play.seconds` reveals one message per period. A sequence is its own drawing and its own file: `orrery render --view checkout-seq`.",
  "7-vocabulary": "The author's own states, replacing the defaults, each bound to a look; a custom line style. Nothing in the tool reads a name.",
};
const examples = stages.map((f) => {
  const name = f.replace(".orrery.json", "");
  const json = JSON.stringify(JSON.parse(readFileSync(`examples/checkout/${f}`, "utf8")), null, 2);
  return `## ${name}\n\n${stageNotes[name] ?? ""}\n\n\`\`\`json\n${json}\n\`\`\`\n`;
}).join("\n");
writeFileSync(`${out}/examples.md`, `# Worked examples

Generated from examples/checkout by tools/skill-refs.mjs. The README's checkout system, grown one stage at a time;
every block below is a complete, valid model. The pictures each one produces are in the repository next to it.

Fuller galleries, each a model file with its pictures:

- **The kitchen sink**, every drawn variant: https://github.com/adamgilman/Orrery/blob/main/examples/kitchen-sink/README.md
- **The moving parts**, views, drill-down, scenarios, play, tour: https://github.com/adamgilman/Orrery/blob/main/examples/moving-parts/README.md
- **Orrery drawn in Orrery**, every feature in one file: https://github.com/adamgilman/Orrery/blob/main/examples/orrery.orrery.json

${examples}`);

// ---- errors.md: what the validator says, from the invalid fixtures, with the input that provoked each
const invalid = readdirSync("fixtures/invalid").filter((f) => f.endsWith(".json") && !f.endsWith(".errors.json")).sort();
const rows = invalid.map((f) => {
  const name = f.replace(".json", "");
  const errors = JSON.parse(readFileSync(`fixtures/invalid/${name}.errors.json`, "utf8"));
  const input = JSON.stringify(JSON.parse(readFileSync(`fixtures/invalid/${f}`, "utf8")));
  return `### ${name}\n\n${errors.map((e) => `- \`${e.pointer}\`: ${e.message}`).join("\n")}\n\nProvoked by: \`${input.length > 300 ? input.slice(0, 300) + "…" : input}\`\n`;
}).join("\n");
writeFileSync(`${out}/errors.md`, `# What the validator says

Generated from fixtures/invalid by tools/skill-refs.mjs. Every error is one line, \`<file>:<json-pointer>: <message>\`,
on stderr, exit code 1. Fix at the pointer. The message names what is known when a name is unknown, so the fix is
usually to pick from the list or define the name in \`states\`, \`kinds\` or \`shapes\`.

Warnings are the same shape with \`(warning)\` and do not fail: today, a source connected both to a group and to
something inside it, and a view whose closed groups can be open in more than 32 combinations.

${rows}`);
console.log(`skill references written: model.md, examples.md (${stages.length} stages), errors.md (${invalid.length} errors)`);
