---
name: orrery-diagrams
description: This skill should be used when the user asks to "draw an architecture diagram", "model this system with Orrery", "write an orrery.json", "add a failure scenario to the diagram", "show what happens when the database fails", "make the diagram animate", "add a tour", "drill down into a group", "export the diagram for the README", "embed the diagram in a page", or mentions Orrery, an .orrery.json file, or animated architecture diagrams in a README.
version: 0.1.0
---

# Orrery diagrams

Orrery turns one JSON file into architecture diagrams that move: a plain SVG that animates inside a README's image
tag, is interactive when opened in a browser, and can be exported as many enclosed pictures from one run. The file
is a model, not a drawing: components, connections, groups, states, views, scenarios, callouts and a tour. Layout is
automatic and deterministic. Nothing is inferred: every state, reason and load in a picture is one the author wrote.

## The reference is the schema

Every property is documented in the JSON Schema, and unknown properties are errors. When unsure what a field takes,
read its description in the schema rather than guessing:

- Published: `https://raw.githubusercontent.com/adamgilman/Orrery/main/packages/core/schema/v1.json`
- Installed: `node_modules/@orrery-diagrams/core/schema/v1.json` after `npm install orrery-diagrams`

Put the URL in the file's `$schema` so editors validate as the user types. The full specification, with numbered
invariants and the reasons behind the design, is `docs/MODEL.md` in the repository.

## Workflow

1. **Understand the system in the author's words.** Ask what the components are, how they connect, what can fail
   and what that does to the rest. Orrery draws exactly what is declared; it computes nothing.
2. **Start from `assets/starter.orrery.json`** or an empty `{ "components": [] }`, and grow it in the order the
   README grows the checkout: parts, groups, connections, scenarios, views, drill-down, vocabulary
   (`references/examples.md`).
3. **Validate after every edit:** `npx orrery-diagrams validate app.orrery.json`. Every error is a JSON pointer and a
   sentence; fix at the pointer (`references/errors.md`). Do not move on with errors.
4. **Render and look.** `npx orrery-diagrams render app.orrery.json --static -o app.svg` for one still,
   `--scenario <id> --step <n>` for a moment, `--open <group>` and `--zoom <id>` for drill-down. Read the SVG if a
   viewer is not available: node labels, `data-state`, `data-callout`, the legend.
5. **Declare the pictures the document needs** as `exports` and write them all with
   `npx orrery-diagrams export app.orrery.json --out docs/`. For a web page, `npx orrery-diagrams embed`.
6. **Commit the model next to the code** it describes; the pictures regenerate from it.

`scripts/check.sh app.orrery.json` runs validate, a still, and every export into a temporary directory in one go.

## The model in brief

| Block | What it says | Reference |
|---|---|---|
| `components` | The running things: id, label, kind, group, state, replicas, tech, description, meta | `references/model.md` |
| `connections` | What one entity does to another, directed, with a kind (line style), label, load 0..1, bidirectional | `references/model.md` |
| `groups` | Containers that mean something: tiers, regions, zones, clusters, boundaries; nested; may be empty | `references/model.md` |
| `states`, `kinds`, `shapes` | The vocabulary: names bound to looks, glyphs, shapes, frames and lines; defaults, packs, your own | `references/variants.md` |
| `views` | Drawings of the model: scope, only, direction, closed groups, play | `references/variants.md` |
| `scenarios` | Ordered, cumulative steps: set states with reasons, restore, move loads, callouts | `references/variants.md` |
| `callouts` | Notes with an arrow at an entity or connection, per moment | `references/variants.md` |
| `tour`, `exports` | A story on a timer; the files one export run writes | `references/variants.md` |

## Rules an agent must keep

- **Never write coordinates.** Layout is automatic; `direction` is the only hint. Order in the file is order on
  the canvas, so list the important things first and declare components in the order data flows.
- **Nothing is inferred.** When something fails, say what that does to each other entity, with a reason, and move
  the loads yourself. The tool will not compute a degraded state or shift traffic.
- **Vocabulary is the author's.** Use the defaults (`on`, `degraded`, `failed`, `off`; `service`, `database`,
  `queue`, `cache`, `gateway`, `client`, `storage`, `function`, `external`) unless the user has words of their own;
  then define them. Nothing in the tool reads a name.
- **Keep it small.** A README diagram is a handful of boxes; fold detail into closed groups and let the reader open
  them. Seven components with a scenario beats thirty without one.
- **Unknown properties are errors, on purpose.** Validate, read the pointer, fix it. Do not invent fields.
- **Reasons are the story.** A state without a reason is a colour; a state with one is an explanation the reader
  sees as a tooltip. Callouts put the explanation on the picture.

## Additional resources

- **`references/model.md`**: every block and field with its default and meaning, condensed from the specification.
- **`references/variants.md`**: every variant with a JSON example: looks, glyphs, shapes, packs, frames, lines,
  views, scenarios, callouts, heading, exports, the tour, and what each renders as.
- **`references/examples.md`**: the checkout system built in stages, each a complete valid file, and where the
  fuller galleries live.
- **`references/errors.md`**: the validator's messages and the fix for each.
- **`assets/starter.orrery.json`**: a small valid model to grow from.
- **`scripts/check.sh`**: validate, render and export in one command.
