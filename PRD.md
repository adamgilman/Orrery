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

## 4. Core model (sketch, to be formalised as JSON Schema in M0)

```jsonc
{
  "$schema": "https://orrery.dev/schema/v1.json",
  "title": "Checkout service",
  "direction": "right",                       // layout hint: right | down
  "nodes": [
    { "id": "web",  "label": "Web tier",   "icon": "aws.alb",  "group": "edge" },
    { "id": "api",  "label": "Checkout API", "icon": "service", "group": "app",  "replicas": 3 },
    { "id": "db",   "label": "Orders DB",  "icon": "aws.rds",  "group": "data", "role": "primary" },
    { "id": "db-r", "label": "Orders DB (replica)", "icon": "aws.rds", "group": "data", "role": "replica" }
  ],
  "groups": [
    { "id": "edge", "label": "Edge" },
    { "id": "app",  "label": "Application", "parent": "region-a" },
    { "id": "data", "label": "Data",        "parent": "region-a" },
    { "id": "region-a", "label": "us-east-1" }
  ],
  "edges": [
    { "from": "web", "to": "api",  "kind": "sync",        "load": 0.7, "label": "HTTPS" },
    { "from": "api", "to": "db",   "kind": "sync",        "load": 0.5, "dependsOn": true },
    { "from": "api", "to": "db-r", "kind": "sync",        "load": 0.0, "fallback": true },
    { "from": "db",  "to": "db-r", "kind": "replication", "load": 0.3 }
  ],
  "scenarios": [
    { "id": "db-failover", "label": "Primary DB fails",
      "steps": [
        { "set": { "db": { "state": "failed" } }, "note": "Primary goes down" },
        { "set": { "edges": { "api->db-r": { "load": 0.5 } } }, "note": "API fails over to replica" }
      ] }
  ]
}
```

Key semantics:
- `load` is 0..1 and drives dash speed/density and stroke width. It is the *only* animation input.
- `state` is `on | off | degraded | failed`. `off` is a user/author choice; `failed`/`degraded` are computed or scripted.
- `dependsOn: true` on an edge means the source cannot be healthy if the target is not, unless a `fallback` edge from the same source is healthy.
- Scenarios are ordered steps of partial overrides. Step-through mode plays them; the "current" scenario is also a static export target.
- Outline = group hierarchy, then nodes. No separate outline model.

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

### Status (2026-09-04)

M0 shipped: schema with descriptions, validator, ELK adapter behind `LayoutEngine`, label-aware layout, animated SVG,
CLI, examples page, fresh-agent test passed first try. Pulled forward from later milestones: load animation (was M2),
PNG rasterisation with a bundled font, and the frame/diff tooling that GIF export will reuse (was M5).
Still open from M0: eyeball confirmation that the README SVG animates on github.com.

### Later milestones (reordered: model semantics before the runtime, so toggles have something to toggle)

| # | Deliverable | Done when |
|---|---|---|
| M1 | Groups (nested) and node kinds with a neutral icon set; visual polish | Three-tier example with tiers and a region reads as professional; contract tests cover group containment |
| M2 | Failure semantics: `state`, `dependsOn`, `fallback`, propagation; scenarios as override steps; static render of any scenario | `orrery render --scenario db-failover --step 2` shows the cascade; propagation is unit-tested as a pure function |
| M3 | Runtime inside the SVG: outline, focus, toggles, scenario picker, step-through, keyboard nav; < 25 KB gz | Click-through test passes on the same file that animates in the README |
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

## 10. Open questions
1. SMIL vs CSS keyframes as the primary animation mechanism. Both work in `<img>`. CSS is easier to freeze at time *t* for GIF export; SMIL is friendlier to `begin`/`end` control. Leaning CSS.
2. Layout hint vocabulary: how much can we expose before agents start micromanaging? Start with `direction`, `rank`, `sameRank`, and nothing else.
3. Icon licensing per provider. Verify AWS/GCP/Azure architecture icon terms before bundling.
4. Schema hosting domain (`orrery.dev`?) and package scope (`@orrery/*` availability on npm).

## 11. Language decision

**TypeScript, strict mode, Node 22+, pnpm workspace, vitest.** Decided 2026-09-04. Escape hatch: a future custom layout engine may be Rust compiled to WASM behind the `LayoutEngine` interface; nothing else needs to change.
