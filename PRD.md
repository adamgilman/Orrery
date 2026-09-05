# Orrery — PRD (v0.1 draft)

> An orrery is a mechanical model of the solar system. You crank it and watch the parts move.
> Orrery makes architecture diagrams that are **models, not pictures**: animated, navigable, and poke-able,
> written by AI agents, explored by humans, and portable as a single SVG file.

## 1. North Star

**A diagram that is a model, in the author's own language.** Every visual behaviour (flow, cascade, dimming,
controls) derives from a small model, never from hand placement. The model is written in the words users use
(components, connections, groups, needs) and in the author's own vocabulary for states and kinds. The tool owns
three layers and nothing else:

- **Representation**: looks, glyphs, frames, animation, legend. Presets provided, every one replaceable.
- **Mechanics**: rank, availability, flow, cascade, counting. The engine never reads a state or kind by name.
- **Navigation**: views, outline, zoom, step-through, morph.

If something cannot be expressed in the model it is not a feature. If the engine has to know what "degraded"
means, the design is wrong. Specification: [docs/MODEL.md](docs/MODEL.md), with numbered invariants.

Three tests every release must pass:

1. **The README test.** The rendered SVG dropped into a GitHub README shows animated flow, with no plugin.
2. **The click-through test.** The *same file* opened directly in a browser is fully interactive: outline, state
   changes with propagation, scenarios, views.
3. **The agent test.** An AI agent given only MODEL.md, the JSON Schema and the CLI can grow a model through the
   progressive walk (components, connections, needs, own vocabulary, scenarios), validating first time at each step,
   and gets the propagated states it expected.

## 2. Users

| Role | Who | What they do |
|---|---|---|
| Author | AI coding agent (Claude Code, Cursor, etc.), occasionally a human | Writes/edits `*.orrery.json`, runs `orrery validate` and `orrery render`, looks at the PNG |
| Navigator | Engineer, architect, reviewer | Opens the interactive SVG/HTML, walks the outline, flips components off, plays failure scenarios |
| Reader | Anyone viewing a README, design doc, PR | Sees the animated static SVG or GIF |

## 3. Scope

### v1 (in scope)
- **Model** (implemented): components, connections (any entity to any entity), nested groups including empty
  ones, needs with alternatives, quorum and outcome states, author-defined states and kinds with defaults, views
  with scope and subset, scenarios with set/restore/load, `meta` as the extensibility escape hatch.
- **Layout**: automatic, deterministic, hierarchical, orthogonal routing, connections to group frames. The author
  gives direction and order, never coordinates. Engines are replaceable behind `LayoutEngine`.
- **Render**: one standalone SVG; CSS animation of flow and pulse; looks and kinds rendered exactly as bound;
  legend in the author's words; ghosts for one-ended connections in scoped views.
- **Runtime** (inside the SVG): outline, zoom, click and state bar to set any state with live propagation,
  scenarios with step-through, view morph, keyboard, hover focus.
- **What-ifs without a scenario**: `render --set <state>=<ids>`.
- **Exports**: `svg` (interactive, graceful in `<img>`), `--static`, per-scenario-step static; `png` and `gif`
  from the frame tooling (M4).
- **Agent surface**: MODEL.md, JSON Schema with a description on every property, `validate` with pointer errors
  and warnings, `render`, later `explain` and `check`.
- **Vocabulary packs**: shippable `states`/`kinds` presets (e.g. an SRE pack, cloud provider kind packs) that a
  file can import, so organisations share a vocabulary without copying blocks (M5).

### Non-goals (v1)
- A GUI editor. Agents author; humans navigate.
- Live data binding (real metrics driving load or state). The model is designed so a feed could set declared
  states later; do not build it.
- Performance, latency or capacity modelling. Load is relative and cosmetic.
- Health expressions as a syntax. Needs are data.
- Flowcharts, ER, class diagrams, state machines, Gantt. Sequence and walkthrough *views of an interaction over
  this model* are in scope (M3b); free-standing sequence diagrams are not.
- Confluence native rendering. Documented fallback: GIF, or iframe macro to hosted HTML.

## 4. Model and views

> **Superseded by [docs/MODEL.md](docs/MODEL.md) (2026-09-05).** The vocabulary is now components/connections/groups,
> dependencies are `needs` on the component, scenarios use verbs, and every invariant is numbered there. The section
> below is kept for history; the schema at `packages/core/schema/v1.next.json` is the formal shape awaiting implementation.


One model, many views. The file's top level *is* the model: `nodes`, `groups`, `edges` describe what exists.
`views` describe how to draw it. `scenarios` and `interactions` are timelines the runtime can play over any view.
Design principle: three view families (topology, deployment, dynamic) over one model, one timeline mechanism.
Not a general diagram meta-model. Flowcharts, ER, class, state machines and Gantt are non-goals forever.

```jsonc
{
  "$schema": "https://orrery.dev/schema/v1.json",
  "title": "Checkout",
  "direction": "right",                       // default for views that do not set their own

  // ---- model ----
  "groups": [
    { "id": "region-a", "label": "us-east-1", "kind": "region" },
    { "id": "app",  "label": "Application", "kind": "tier", "parent": "region-a" },
    { "id": "data", "label": "Data",        "kind": "tier", "parent": "region-a" }
  ],
  "nodes": [
    { "id": "web",  "label": "Web tier",     "kind": "gateway" },
    { "id": "api",  "label": "Checkout API", "kind": "service",  "group": "app" },
    { "id": "db",   "label": "Orders DB",    "kind": "database", "group": "data" },
    { "id": "db-r", "label": "Orders DB (replica)", "kind": "database", "group": "data" }
  ],
  "edges": [
    { "id": "web->api", "from": "web", "to": "api", "kind": "sync", "load": 0.7, "label": "HTTPS" },
    { "from": "api", "to": "db",   "kind": "sync",        "load": 0.5, "dependsOn": true },   // id defaults to "api->db"
    { "from": "api", "to": "db-r", "kind": "sync",        "load": 0.0, "fallback": true },
    { "from": "db",  "to": "db-r", "kind": "replication", "load": 0.3 }
  ],

  // ---- views (optional; default is one topology view of everything) ----
  "views": [
    { "id": "overview", "type": "topology", "direction": "right" },
    { "id": "data-tier", "type": "topology", "scope": "data" }          // C4-style drill-down: children of a group
    // later: { "id": "checkout-flow", "type": "sequence", "interaction": "place-order" }
  ],

  // ---- timelines (M2+) ----
  "scenarios": [
    { "id": "db-failover", "label": "Primary DB fails",
      "steps": [                                                        // cumulative: step k applies steps 1..k
        { "note": "Primary goes down",            "nodes": { "db": { "state": "failed" } } },
        { "note": "API fails over to replica",    "edges": { "api->db-r": { "load": 0.5 } } }
      ] }
  ],
  "interactions": [                                                       // designed, not built until the runtime can play it
    { "id": "place-order", "label": "Place order",
      "steps": [ { "edge": "web->api", "message": "POST /orders" }, { "edge": "api->db", "message": "INSERT order", "response": "id" } ] }
  ]
}
```

Vocabulary (small on purpose; every value has a glyph and a meaning across all views):

| Field | Values |
|---|---|
| node `kind` | `service` (default), `database`, `queue`, `cache`, `gateway`, `client`, `storage`, `function`, `external` |
| group `kind` | `tier` (default), `region`, `zone`, `cluster`, `boundary` |
| edge `kind` | `sync` (default), `async`, `replication`, `dataflow` |
| view `type` | `topology` now; `sequence`, `walkthrough` later |

Semantics that hold in every view:
- Edge `id` defaults to `"<from>-><to>"` and must be unique; several edges between one pair need explicit ids. Views, scenarios and interactions reference edges by id, never by position.
- `load` is 0..1 and is the *only* animation input. `state` is `on | off | degraded | failed`.
- `dependsOn: true` on an edge means the source cannot be healthy if the target is not, unless a `fallback` edge covering that edge (`fallbackFor`) is healthy, in which case the source is degraded. `dependsOn: "soft"` only degrades. Degradation propagates. Edge kinds never imply dependency by themselves.
- A view's `scope` is a group id; the view shows that group as the root frame, its descendants, and the edges among them. Edges to nodes outside the scope are dropped today; drawing them as stubs is a later refinement.
- Outline = group hierarchy, then nodes. No separate outline model.
- Timelines are ordered steps. The runtime has one step-through control that plays scenarios (state changes) and interactions (messages) alike; a sequence view is another renderer for an interaction.

## 5. Outputs and portability matrix

| Target | Format | Animation | Interactive |
|---|---|---|---|
| GitHub README, most markdown renderers | `orrery.svg` via `<img>` | yes (CSS/SMIL) | no |
| Browser, GitHub Pages, jsDelivr link, Backstage, iframe macros | same `orrery.svg`, or `orrery.html` | yes | **yes** |
| Confluence Cloud, Slack, Google Docs, anything raster-only | `orrery.gif` / `.png` | GIF yes | no |
| PR review | per-scenario static SVGs | no | no |

Rule: **one source file, every output derived**. Layout runs at build time so the shipped SVG carries coordinates and needs no layout engine at view time.

## 6. Architecture

Monorepo, TypeScript, strict. Packages are split along the seams we expect to replace.

| Package | Responsibility | Replaceability note |
|---|---|---|
| `@orrery/schema` | JSON Schema + TS types + validator with pointer-precise errors | stable contract, versioned |
| `@orrery/core` | Model normalisation, dependency/failure propagation, `LayoutEngine` interface, scene graph | pure, no DOM, no I/O |
| `@orrery/layout-elk` | First `LayoutEngine` impl wrapping elkjs | **the one we expect to outgrow**; nothing outside this package imports elk |
| `@orrery/render-svg` | Scene graph to SVG string; CSS/SMIL animation; embeds model + runtime | |
| `@orrery/runtime` | Vanilla JS (built from TS) inlined into the SVG: outline, controls, scenarios, keyboard nav. Budget: **< 25 KB min+gz**, zero deps | never React |
| `@orrery/raster` | SVG at time *t* to PNG (resvg) and GIF frames | animation is a pure function of (model, t), so frames never need a browser |
| `orrery` (CLI) | `validate`, `render`, `explain`, `watch`, `init` | `npx orrery` is the agent entry point |

Layout boundary, so we can swap engines or write our own:

```ts
interface LayoutEngine {
  layout(graph: LayoutGraph, hints: LayoutHints): Promise<LayoutResult>; // positions, sizes, edge routes (polyline/orthogonal)
}
```
`LayoutGraph` is Orrery's own type, not ELK's. Determinism is a contract: same input, same bytes out.

## 7. Milestones

### M0 — "Thin slice" (first milestone, deliberately tiny)

One JSON file in, one animated SVG out, proven on GitHub. No groups, no icons, no scenarios, no runtime.

**Input** (the only fields M0 accepts; everything else is a validation error):
```json
{ "direction": "right",
  "nodes": [ { "id": "web", "label": "Web" }, { "id": "api", "label": "API" }, { "id": "db", "label": "DB" } ],
  "edges": [ { "from": "web", "to": "api", "load": 0.8 }, { "from": "api", "to": "db", "load": 0.4 } ] }
```

**Commands**
- `orrery validate <file>`: exit 0, or exit 1 with one line per error carrying a JSON pointer (`/edges/1/to: unknown node "dbb"`).
- `orrery render <file> -o out.svg`: rounded-rect nodes with labels, orthogonal edges with arrowheads, dashed flow animated at a speed proportional to `load`. Deterministic bytes.

**Done when**
1. `out.svg` dropped in a README animates on github.com. (README test, minimal form.)
2. Rendering the same file twice yields identical bytes.
3. A fresh agent given only the schema and the two commands produces a valid 5-node diagram in one attempt.

**Explicitly deferred**: groups, icons, `dependsOn`/`fallback`, scenarios, runtime, PNG/GIF, `explain`, `watch`, MCP.

**Packages in M0** (pnpm workspace, vitest): `@orrery/core` (schema, validator, model, `LayoutEngine` interface, SVG renderer), `@orrery/layout-elk` (the only importer of elkjs), `orrery` (CLI). Splitting `core` further waits until a second consumer exists.

### Status (2026-09-05, later): the model specification is implemented

`docs/MODEL.md` is now the implemented shape: components/connections/groups vocabulary, author-defined states and
kinds with looks and mechanics, `needs` with alternatives/quorum/outcomes on the component, connections and needs to
groups (including empty groups), views with `scope` and `only` and ghosts for one-ended connections, scenarios with
`set`/`restore`/`load`, `render --set` for one-off what-ifs, validator warnings, legend. Engine, renderer, runtime
and CLI all moved in three commits; 205 tests. Examples migrated. The old shape is gone.

### Status (2026-09-05)

M3 shipped: the runtime lives inside the raw SVG. `orrery render` now emits the interactive document by default: every
view pre-laid-out and embedded (first visible, so `<img>` shows the animated first view), the validated model as JSON,
and a 6 KB gzipped runtime. Opened directly: panel with outline, view and scenario pickers, step-through with notes,
click to fail / shift-click to switch off with live propagation, hover to highlight neighbours, camera zoom on select,
view switching with a node morph, keyboard shortcuts, reset. No layout engine in the browser. Phase continuity when
load changes. `--static` gives the old single-view file; `--scenario` implies static. Frame tooling inspects only the
visible view. Runtime behaviour is tested in jsdom (panel, toggles, scenarios, view switch, keyboard), and the minified bundle is
executed inside a rendered SVG document's window as a test (jsdom does not run SVG <script> elements by itself, so the
test injects it). Not yet verified in a real browser by a human.

### Status (2026-09-04, night)

M2 shipped: node `state`, `dependsOn`/`fallback` edges, scenarios with cumulative steps, propagation as a pure fixed-point
function with reasons (rendered as tooltips), state styling (failed pulses red, degraded amber, off dimmed), edges to down
nodes stop flowing, fallback edges take over load, `render --scenario --step`. Frame tooling freezes the pulse too.
Propagation rules as built: declared state is a floor; a dependsOn target that is off/failed fails the source unless a
healthy fallback exists (then degraded); a degraded target degrades the source; non-dependsOn edges never propagate.

### Status (2026-09-04, evening)

M1 first pass shipped: model/view schema (edge ids and kinds, node and group kinds, nested groups, views with scope),
containment contract, ELK compound layout, group frames, kind glyphs, edge-kind styles, `render --view`. Found and
worked around an ELK 0.9 crash (considerModelOrder inside compound graphs). Second fresh-agent test passed first try (13 nodes, 6
nested groups, 16 edges, drill-down view). Polish pass done: a measured sweep of 15 ELK options (`tools/layout-tune.mjs`,
scored by bends, edge length, edges through nodes, foreign-frame crossings) found no improvement over the baseline, which
already scores zero on the last two. Long over-the-top routes are inherent to layered layout; the runtime's focus mode
(M3) is the planned answer, not more tuning. M1 closed.

### Status (2026-09-04, M0)

M0 shipped: schema with descriptions, validator, ELK adapter behind `LayoutEngine`, label-aware layout, animated SVG,
CLI, examples page, fresh-agent test passed first try. Pulled forward from later milestones: load animation (was M2),
PNG rasterisation with a bundled font, and the frame/diff tooling that GIF export will reuse (was M5).
README test confirmed on github.com in Safari and in the GitHub mobile app (M0 complete). The mobile app cannot zoom
markdown images, so the README's first diagram is narrow: direction "down", few nodes, short labels (the solar system).

### Roadmap (aligned to the model, 2026-09-05)

Done: M0 thin slice, M1 groups/kinds/views, M2 failure semantics, M3 runtime, and the model redesign that
replaced fixed system states with the author's vocabulary (docs/MODEL.md). What remains is ordered by how much it
strengthens the thesis that the file is a model in the author's language.

| # | Deliverable | Done when |
|---|---|---|
| R1 | **Browser click-through by a human**; fix what only eyes can find (panel width, morph feel, legend placement). | The user reports the interactive file works on desktop Safari/Chrome |
| R2 | **`orrery explain`**: the model in prose, in the author's vocabulary ("Checkout API needs Orders DB or Orders replica; today Orders DB is in outage, so it is impaired, running on the replica"). Agents self-check with it; humans read it. | Explain output for every fixture is snapshot-tested and reads as English |
| R3 | **`orrery check`: scenario notes as assertions.** A step may carry `expect: { "<state>": [ids] }` (and later expected loads); `check` runs every scenario and diffs expectations against propagation. The agent tests showed notes are claims about engine output; make them checkable. | CI fails when a model's story and its mechanics disagree |
| R4 | **Vocabulary packs**: `"states": { "use": "sre" }` / `"kinds": { "use": ["aws"] }` pulling presets shipped with the tool (licence-checked cloud glyphs), overridable as today. | A file with a pack renders cloud glyphs; replacing one entry works |
| M3b | **Interactions and views of them**: `interactions` (ordered messages over connections); `walkthrough` view (a token moving along the topology) and `sequence` view (lifelines from entities). Both play through the runtime's step-through with the morph. | A click on a component swaps to its sequence view; the same interaction animates on the topology |
| M4 | **GIF/PNG export** from the frame tooling; `render --png/--gif`. | Confluence fallback documented with a real GIF; agents can look at their own output |
| M5 | **Launch**: docs site built from MODEL.md, examples gallery, MCP server exposing validate/render/explain/check, agent eval harness with retry counts, tags and neighbourhood views if the backlog still wants them. | Public |

Principles for adding anything: it must be expressible in the author's vocabulary, it must add or change a
numbered invariant in MODEL.md with a test, and the engine must still pass B10 (names do not matter).

## 8. Engineering rules

- **TDD, no exceptions.** Every behaviour lands as a failing test first. Order per feature: schema fixture (valid/invalid JSON) → unit test → snapshot/e2e. PRs without tests are not reviewed.
- **Test layers**: (1) validator tests driven by fixture files under `fixtures/valid` and `fixtures/invalid` with expected error pointers; (2) `core` tests use a `FakeLayoutEngine` that places nodes on a grid, so render tests never touch ELK; (3) `layout-elk` has a contract test asserting determinism and that every node/edge gets a position/route; (4) SVG snapshot tests; (5) CLI e2e via child process on the fixture files.
- **Determinism is tested**, not assumed: render twice, compare bytes.
- **Layout hints** are the ELK vocabulary surfaced selectively (`direction`, then `rank`/`sameRank` when needed). No coordinates in the schema, ever.
- **ELK quarantine**: `elkjs` is imported by `@orrery/layout-elk` only. A test enforces it.
- **Specification first**: a change to what the file can say starts in `docs/MODEL.md` as an invariant with a test
  name, then the test, then the code. The engine reads mechanics only (B10); the renderer reads looks only (R8).
- **Vocabulary boundary**: user-facing text (schema descriptions, errors, CLI, README, legend) says components,
  connections, groups, needs, states, kinds. Graph words stay below `toLayoutGraph`.

## 9. Success metrics (first 90 days after launch)
- An agent with no prior exposure produces a valid, good-looking diagram from the schema alone (measured with a fixed eval prompt set).
- Demo README SVG animates on GitHub with no manual tweaks.
- Runtime under budget; a 200-node diagram renders and stays interactive at 60 fps on a laptop.

## 10. Backlog from agent tests

Two fresh agents (M0 and M1 schemas) each validated on the first attempt. What they wanted and could not express,
kept here so the model grows from evidence rather than guesswork:

- ~~Cross-boundary edges in a scoped view drawn as stubs~~ done: ghosts (R4).
- ~~Edges whose endpoint is a group~~ done: connections and needs to any entity.
- ~~Node attributes beyond label: technology, description, replica count~~ done: `tech`, `description`, `replicas`, `meta`. Multi-line labels: open.
- ~~Bidirectional edges~~ done.
- Group-level layout direction (region left-to-right, a tier inside it top-to-bottom): open.
- ~~Inactive/failover edges as state~~ done: needs with alternatives, load shifts automatically.
- View-level emphasis: highlight a subset on the full topology: lands with interactions (M3b).
- ~~Subcommand `--help`, scope semantics~~ done.
- From the M2 agent test: ~~fallbacks must name what they cover; soft dependencies~~ superseded by `needs` with
  `any`/`min`/`unmet`/`reduced`. Still open: scenario steps that change topology or labels ("replica promoted to
  primary"); a queue absorbing degradation is now expressible (do not declare the need, or give it `reduced` = the
  default state).

## 11. Open questions
1. **Resolved: CSS keyframes, not SMIL** (2026-09-04). Both play inside `<img>`; nothing outside browsers plays either. CSS wins on control: the Web Animations API gives the runtime one timeline (pause, scrub, playback rate) over every animation. Rule that follows: animation stays a pure function of (model, t); when load changes at runtime, continue from the current phase, never restart.
2. Layout hint vocabulary: how much can we expose before agents start micromanaging? Start with `direction`, `rank`, `sameRank`, and nothing else.
3. Icon licensing per provider. Verify AWS/GCP/Azure architecture icon terms before bundling.
4. Schema hosting domain (`orrery.dev`?) and package scope (`@orrery/*` availability on npm).

## 12. Language decision

**TypeScript, strict mode, Node 22+, pnpm workspace, vitest.** Decided 2026-09-04. Escape hatch: a future custom layout engine may be Rust compiled to WASM behind the `LayoutEngine` interface; nothing else needs to change.
