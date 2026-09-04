# Orrery — PRD (v0.1 draft)

> An orrery is a mechanical model of the solar system. You crank it and watch the parts move.
> Orrery makes architecture diagrams that are **models, not pictures**: animated, navigable, and poke-able,
> written by AI agents, explored by humans, and portable as a single SVG file.

## 1. North Star

**A diagram that is a model.** Every visual behaviour (flow animation, failure cascade, dimming, controls)
is derived from a small semantic model, never hand-drawn. If it cannot be expressed in the model, it is not a feature.

Three tests every release must pass:

1. **The README test.** An `orrery.svg` dropped into a GitHub README shows animated load on connectors, with no plugin.
2. **The click-through test.** The *same file* opened directly in a browser is fully interactive: outline, toggles, failure scenarios.
3. **The agent test.** An AI agent given only the JSON Schema and the CLI can produce a correct, professional diagram of a
   three-tier system in one validate/render loop, without ever choosing a coordinate.

## 2. Users

| Role | Who | What they do |
|---|---|---|
| Author | AI coding agent (Claude Code, Cursor, etc.), occasionally a human | Writes/edits `*.orrery.json`, runs `orrery validate` and `orrery render`, looks at the PNG |
| Navigator | Engineer, architect, reviewer | Opens the interactive SVG/HTML, walks the outline, flips components off, plays failure scenarios |
| Reader | Anyone viewing a README, design doc, PR | Sees the animated static SVG or GIF |

## 3. Scope

### v1 (in scope)
- **Model**: nodes, groups (nested), edges with load and kind, scenarios (named state overrides), metadata.
- **Layout**: automatic, deterministic, hierarchical, orthogonal edge routing. Author gives *hints* (direction, rank, pin-to-group), never coordinates.
- **Render**: standalone SVG. CSS/SMIL animation of load along edges. Embedded model + vanilla-JS runtime for interactivity.
- **Runtime** (inside the SVG): outline tree, focus/zoom on select, component on/off toggles, scenario picker, step-through mode, hover highlights full path, keyboard navigation.
- **Failure simulation**: turning a node off (or a scenario doing so) propagates through `dependsOn` edges; downstream nodes degrade or fail unless a `fallback` edge exists. Rendered as dim + red pulse.
- **Exports**: `svg` (graceful), `svg --static --scenario X`, `png`, `gif` (animated, N seconds, fixed fps), `html` (single file wrapper).
- **Agent surface**: JSON Schema, `validate` with line/pointer-precise errors, `render`, `explain` (plain-English description of the model, for self-checking), `watch`.
- **Icons**: built-in neutral icon set + cloud provider sets (AWS/GCP/Azure) where licence permits.

### Non-goals (v1)
- A GUI editor. Agents author; humans navigate.
- Live data binding (real metrics driving load). Design the model so it is possible later; do not build it.
- Sequence diagrams, ER diagrams, flowcharts. Architecture/topology only.
- Confluence native rendering. Documented fallback: GIF, or iframe macro to hosted HTML.

## 4. Model and views

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

### Later milestones (reordered: model semantics before the runtime, so toggles have something to toggle)

| # | Deliverable | Done when |
|---|---|---|
| M1 | Model/view schema shape (edge ids and kinds, node and group kinds, `views` with `scope`); nested groups; neutral glyph set; visual polish | Three-tier example with tiers and a region reads as professional; contract tests cover group containment; `render --view` works |
| M2 | Failure semantics: `state`, `dependsOn`, `fallback`, propagation; scenarios as override steps; static render of any scenario | Done: `orrery render --scenario db-failover --step 2` shows the cascade; propagation is unit-tested as a pure function |
| M3 | Runtime inside the SVG: outline, camera zoom, toggles with failure propagation, scenario picker, step-through, keyboard nav; all views embedded in one file with a morph between views; < 25 KB gz (actual: ~6 KB). No layout engine in the browser. | Done in jsdom; awaiting a human click-through in a browser |
| M3b | `sequence` view type: lifelines from nodes, messages from an interaction; and `walkthrough`: a token moving along the topology for the same interaction | A click on a component swaps to its sequence view with the morph |
| M4 | GIF export from the frame tooling; `orrery render --png/--gif` | Confluence fallback documented with a real GIF; agents can look at their own output via `--png` |
| M5 | Demo repo, docs site, MCP server, agent eval harness with retry counts | Public launch |

## 8. Engineering rules

- **TDD, no exceptions.** Every behaviour lands as a failing test first. Order per feature: schema fixture (valid/invalid JSON) → unit test → snapshot/e2e. PRs without tests are not reviewed.
- **Test layers**: (1) validator tests driven by fixture files under `fixtures/valid` and `fixtures/invalid` with expected error pointers; (2) `core` tests use a `FakeLayoutEngine` that places nodes on a grid, so render tests never touch ELK; (3) `layout-elk` has a contract test asserting determinism and that every node/edge gets a position/route; (4) SVG snapshot tests; (5) CLI e2e via child process on the fixture files.
- **Determinism is tested**, not assumed: render twice, compare bytes.
- **Layout hints** are the ELK vocabulary surfaced selectively (`direction`, then `rank`/`sameRank` when needed). No coordinates in the schema, ever.
- **ELK quarantine**: `elkjs` is imported by `@orrery/layout-elk` only. Lint rule enforces it.

## 9. Success metrics (first 90 days after launch)
- An agent with no prior exposure produces a valid, good-looking diagram from the schema alone (measured with a fixed eval prompt set).
- Demo README SVG animates on GitHub with no manual tweaks.
- Runtime under budget; a 200-node diagram renders and stays interactive at 60 fps on a laptop.

## 10. Backlog from agent tests

Two fresh agents (M0 and M1 schemas) each validated on the first attempt. What they wanted and could not express,
kept here so the model grows from evidence rather than guesswork:

- Cross-boundary edges in a scoped view drawn as stubs (most requested; real information loss today).
- Edges whose endpoint is a group ("routes to the region"), not a representative node.
- Node attributes beyond label: technology, description/tooltip, role (primary/replica), replica count. Multi-line labels.
- Bidirectional or request/response edges without drawing two.
- Group-level layout direction (region left-to-right, a tier inside it top-to-bottom).
- Inactive/failover edges expressed as state rather than `load: 0` (lands with M2).
- View-level emphasis: highlight a subset of edges on the full topology (lands with interactions).
- Subcommand `--help` (fixed), scope semantics spelled out in the schema (fixed).
- From the M2 agent test: fallbacks must name what they cover (`fallbackFor`, fixed; the agent's standby card processor
  had silently taken over a database failure); soft dependencies (`dependsOn: "soft"`, fixed); document that degradation
  propagates and fallback activation is automatic (fixed). Still open: scenario steps that change topology or labels
  ("replica promoted to primary"), and a way for a queue to absorb degradation so async consumers do not inherit it.

## 11. Open questions
1. **Resolved: CSS keyframes, not SMIL** (2026-09-04). Both play inside `<img>`; nothing outside browsers plays either. CSS wins on control: the Web Animations API gives the runtime one timeline (pause, scrub, playback rate) over every animation. Rule that follows: animation stays a pure function of (model, t); when load changes at runtime, continue from the current phase, never restart.
2. Layout hint vocabulary: how much can we expose before agents start micromanaging? Start with `direction`, `rank`, `sameRank`, and nothing else.
3. Icon licensing per provider. Verify AWS/GCP/Azure architecture icon terms before bundling.
4. Schema hosting domain (`orrery.dev`?) and package scope (`@orrery/*` availability on npm).

## 12. Language decision

**TypeScript, strict mode, Node 22+, pnpm workspace, vitest.** Decided 2026-09-04. Escape hatch: a future custom layout engine may be Rust compiled to WASM behind the `LayoutEngine` interface; nothing else needs to change.
