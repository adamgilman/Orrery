# Orrery PRD

> An orrery is a mechanical model of the solar system. You crank it and watch the parts move.
> Orrery makes architecture diagrams that are **models, not pictures**: animated, navigable, and poke-able,
> written by AI agents, explored by humans, and portable as a single SVG file.

## 1. North Star

**A diagram that is a model, in the author's own language.** Everything in a picture (boxes, lines, flow, states,
dimming, controls) derives from a small model the author wrote, never from hand placement and never from
inference. Two layers, as in the specification:

- **Vocabulary**, owned by the author: the names of states and kinds, what they mean, and every state in every
  scenario step.
- **Representation**, owned by the renderer: looks, glyphs, frames, lines, animation, legend. Presets, all
  replaceable.

Navigation (views, outline, zoom, step-through, drill-down, morph) is what the runtime builds on top of those.

If something cannot be expressed in the model it is not a feature. If the tool has to know what "degraded" means,
or work out what a failure does to the rest of the system, the design is wrong: it is the author's diagram.
Specification: [docs/MODEL.md](docs/MODEL.md), with numbered invariants.

Three tests every release must pass:

1. **The README test.** The rendered SVG dropped into a GitHub README shows animated flow, with no plugin.
2. **The click-through test.** The *same file* opened directly in a browser is fully interactive: outline, state
   changes, scenarios, views, drill-down.
3. **The agent test.** An AI agent given only MODEL.md, the JSON Schema and the CLI can grow a model through the
   progressive walk (components, groups, connections, scenarios, views, own vocabulary), validating first time at
   each step, and gets the pictures it expected.

## 2. Users

| Role | Who | What they do |
|---|---|---|
| Author | AI coding agent (Claude Code, Cursor, etc.), occasionally a human | Writes `*.orrery.json`, runs `validate` and `render`, looks at the result with `yarn inspect` |
| Navigator | Engineer, architect, reviewer | Opens the interactive SVG/HTML, walks the outline, flips components off, plays failure scenarios |
| Reader | Anyone viewing a README, design doc, PR | Sees the animated static SVG or GIF |

## 3. Scope

### v1 (in scope)
- **Model** (implemented): components, connections (any entity to any entity), nested groups including empty
  ones, author-defined states and kinds (component glyphs, group frames, connection lines) with defaults, views
  with scope, subset and collapsed groups, scenarios with set (states with reasons), restore and load, tours,
  `meta` as the extensibility escape hatch.
- **Layout**: automatic, deterministic, hierarchical, orthogonal routing, connections to group frames. The author
  gives direction and order, never coordinates. Engines are replaceable behind `LayoutEngine`.
- **Render**: one standalone SVG; CSS animation of flow and pulse; looks and kinds rendered exactly as bound;
  legend in the author's words; ghosts for one-ended connections in scoped views.
- **Runtime** (inside the SVG): outline, zoom, click and state bar to set any state, scenarios with step-through,
  view morph, drill-down with a camera, keyboard, hover focus.
- **What-ifs without a scenario**: `render --set <state>=<ids>`.
- **Exports**: `svg` (interactive, graceful in `<img>`), `--static`, per-scenario-step static; `png` and `gif`
  from the frame tooling (M4).
- **Agent surface**: MODEL.md, JSON Schema with a description on every property, `validate` with pointer errors
  and warnings, `render`, later `explain` and `check`.
- **Vocabulary packs**: shippable `states`/`kinds` presets (e.g. an SRE pack, cloud provider kind packs) that a
  file can import, so organisations share a vocabulary without copying blocks (roadmap: packs).

### Non-goals (v1)
- A GUI editor. Agents author; humans navigate.
- Live data binding (real metrics driving load or state). The model is designed so a feed could set declared
  states later; do not build it.
- Performance, latency or capacity modelling. Load is relative and cosmetic.
- Computing states. What a failure does to the rest of the system is the author's to say; the tool draws it.
- Flowcharts, ER, class diagrams, state machines, Gantt. Sequence and walkthrough *views of an interaction over
  this model* are in scope (M3b); free-standing sequence diagrams are not.
- Confluence native rendering. Documented fallback: GIF, or iframe macro to hosted HTML.

## 4. Model and views

Specified in [docs/MODEL.md](docs/MODEL.md). That document is normative; nothing here restates it.

## 5. Outputs and portability matrix

| Target | Format | Animation | Interactive |
|---|---|---|---|
| GitHub README, most markdown renderers | `orrery.svg` via `<img>` | yes (CSS/SMIL) | no |
| Browser, GitHub Pages, jsDelivr link, Backstage, iframe macros | same `orrery.svg`, or `orrery.html` | yes | **yes** |
| Confluence Cloud, Slack, Google Docs, anything raster-only | `orrery.gif` / `.png` | GIF yes | no |
| PR review | per-scenario static SVGs | no | no |

Rule: **one source file, every output derived**. Layout runs at build time so the shipped SVG carries coordinates and needs no layout engine at view time.

## 6. Architecture

Monorepo, TypeScript, Yarn 4. Packages are split along the seams we expect to replace.

| Package | Responsibility | Replaceability note |
|---|---|---|
| `@orrery/core` | JSON Schema, validator, declaration (scenario steps folded into the model), view scoping, `LayoutEngine` interface and fake engine, SVG renderer, document assembly | the model; pure, no DOM |
| `@orrery/layout-elk` | `LayoutEngine` backed by elkjs | the one we expect to outgrow; nothing else imports elk (a test enforces it) |
| `@orrery/runtime` | Vanilla JS inlined into the SVG: panel, outline, camera, state changes, scenarios, view morph. Budget 25 KB gzipped (currently ~6) | never React |
| `@orrery/raster` | Freeze animation at time *t*, rasterise with a bundled font, frame diffs, `inspect` | frames are a pure function of (model, t), so no browser is needed |
| `orrery` (CLI) | `validate`, `render` (`--view`, `--static`, `--scenario`, `--step`, `--set`) | `node packages/cli/dist/main.js` today; `npx orrery` after publishing |

Layout boundary, so we can swap engines or write our own:

```ts
interface LayoutEngine {
  layout(graph: LayoutGraph): Promise<LayoutResult>; // positions, sizes, edge routes; deterministic
}
```
`LayoutGraph` is Orrery's own type, built by `toLayoutGraph`, the only place the user vocabulary meets graph terms.

## 7. Milestones

### Done (all 2026-09-04 to 2026-09-05)

| Milestone | What shipped |
|---|---|
| M0 thin slice | Schema, validator with pointer errors, ELK behind `LayoutEngine`, animated SVG, CLI, examples page. README animation confirmed on GitHub web and mobile. Fresh agent validated first try. |
| M1 model and views | Groups, kinds, views with scope, label-aware layout, group frames and glyphs. Measured ELK option sweep found no win over the baseline. |
| M2 failure semantics | Declared states, dependencies with alternatives, cumulative scenarios, pure propagation with reasons, state styling, frame tooling that freezes the pulse. |
| M3 runtime | Runtime inside the raw SVG: outline, zoom, state changes with live propagation, scenario step-through, multi-view morph, keyboard. CLI emits the interactive document by default. Verified in jsdom; browser check pending. |
| Timer playback | A view can `play` a scenario: pre-rendered step layers cycled by CSS in the file (plays in a README), and runtime autoplay until the reader interacts. |
| Model redesign | The specification in docs/MODEL.md replaced fixed system states with the author's vocabulary, moved dependencies to `needs` on components, made connections fluid across entities, added `--set`, warnings, legend, ghosts. Four fresh-agent walks, zero validation failures on the last one. |
| Drill-down and tours | Closed groups drawn as node-sized boxes; opening one lays the view out again and the picture moves between layouts, to any depth, in the file's tour and in the runtime; frame tooling in resvg and real Chromium to debug transitions frame by frame. |
| Declared model | Propagation removed: no needs, rank, availability, cascade or load shifting. Every state, reason and load in a picture is one the author wrote in a scenario step or what-if. Connection kinds became author-defined line styles. |

### Roadmap (aligned to the model, 2026-09-05)

Ordered by how directly each item serves the thesis that the file is a model in the author's language.

| # | Deliverable | Done when |
|---|---|---|
| N1 | **Browser click-through by a human**; fix what only eyes can find (panel width, morph feel, legend placement). | The user reports the interactive file works on desktop Safari/Chrome |
| N2 | **`orrery explain`**: the model and a scenario in prose, in the author's vocabulary ("Step 1: Orders DB fails. Checkout API is degraded: reads from the replica."). Agents self-check with it; humans read it. | Explain output for every fixture is snapshot-tested and reads as English |
| N3 | **Vocabulary packs**: `"states": { "use": "sre" }` / `"kinds": { "use": ["aws"] }` pulling presets shipped with the tool (licence-checked cloud glyphs), overridable as today. | A file with a pack renders cloud glyphs; replacing one entry works |
| M3b | **Interactions and views of them**: `interactions` (ordered messages over connections); `walkthrough` view (a token moving along the topology) and `sequence` view (lifelines from entities). Both play through the runtime's step-through with the morph. | A click on a component swaps to its sequence view; the same interaction animates on the topology |
| M4 | **GIF/PNG export** from the frame tooling; `render --png/--gif`. | Confluence fallback documented with a real GIF; agents can look at their own output |
| M5 | **Launch**: docs site built from MODEL.md, examples gallery, MCP server exposing validate/render/explain/check, agent eval harness with retry counts, tags and neighbourhood views if the backlog still wants them. | Public |

Principles for adding anything: it must be expressible in the author's vocabulary, it must add or change a
numbered invariant in MODEL.md with a test, and it must never compute a state (B3).

## 8. Engineering rules

- **TDD, no exceptions.** Every behaviour lands as a failing test first. Order per feature: schema fixture (valid/invalid JSON) → unit test → snapshot/e2e. PRs without tests are not reviewed.
- **Test layers**: (1) validator tests driven by fixture files under `fixtures/valid` and `fixtures/invalid` with expected error pointers; (2) `core` tests use a `FakeLayoutEngine` that places nodes on a grid, so render tests never touch ELK; (3) `layout-elk` has a contract test asserting determinism and that every node/edge gets a position/route; (4) SVG snapshot tests; (5) CLI e2e via child process on the fixture files.
- **Determinism is tested**, not assumed: render twice, compare bytes.
- **Layout hints**: `direction` and declaration order are the only ones. More only if a real diagram cannot be fixed otherwise. No coordinates in the schema, ever.
- **ELK quarantine**: `elkjs` is imported by `@orrery/layout-elk` only. A test enforces it.
- **Specification first**: a change to what the file can say starts in `docs/MODEL.md` as an invariant with a test
  name, then the test, then the code. Nothing computes a state (B3); the renderer reads looks only (R8).
- **Vocabulary boundary**: user-facing text (schema descriptions, errors, CLI, README, legend) says components,
  connections, groups, states, kinds. Graph words stay below `toLayoutGraph`.

## 9. Success metrics (first 90 days after launch)
- An agent with no prior exposure produces a valid, good-looking diagram from the schema alone (measured with a fixed eval prompt set).
- Demo README SVG animates on GitHub with no manual tweaks.
- Runtime under budget; a 200-node diagram renders and stays interactive at 60 fps on a laptop.

## 10. Backlog from agent tests

Two fresh agents (M0 and M1 schemas) each validated on the first attempt. What they wanted and could not express,
kept here so the model grows from evidence rather than guesswork:

- ~~Cross-boundary edges in a scoped view drawn as stubs~~ done: ghosts (R4).
- ~~Edges whose endpoint is a group~~ done: connections to any entity.
- ~~Node attributes beyond label: technology, description, replica count~~ done: `tech`, `description`, `replicas`, `meta`. Multi-line labels: open.
- ~~Bidirectional edges~~ done.
- Group-level layout direction (region left-to-right, a tier inside it top-to-bottom): open.
- From the fourth walk: ~~partial capability, per-need flow behaviour, quorum on a group~~ moot since the declared
  model (the author writes the outcome). Still open: a `description` on a scenario; per-direction load on a
  bidirectional connection; semantic checks after schema errors in one round trip.
- ~~Inactive/failover edges as state~~ done: a step sets the load on the failover line.
- View-level emphasis: highlight a subset on the full topology: lands with interactions (M3b).
- ~~Subcommand `--help`, scope semantics~~ done.
- From the M2 agent test: ~~fallbacks must name what they cover; soft dependencies~~ moot: the author states each
  outcome. Still open: scenario steps that change topology or labels ("replica promoted to primary"). A queue
  absorbing degradation is expressible: leave the worker in its state and say why.

## 11. Open questions
1. **Resolved: CSS keyframes, not SMIL** (2026-09-04). Both play inside `<img>`; nothing outside browsers plays either. CSS wins on control: the Web Animations API gives the runtime one timeline (pause, scrub, playback rate) over every animation. Rule that follows: animation stays a pure function of (model, t); when load changes at runtime, continue from the current phase, never restart.
2. Icon licensing per provider. Verify AWS/GCP/Azure architecture icon terms before bundling.
3. Schema hosting domain (`orrery.dev`?) and package scope (`@orrery/*` availability on npm).

## 12. Language decision

**TypeScript, strict mode, Node 22+, Yarn 4 workspace, vitest.** Decided 2026-09-04. Escape hatch: a future custom layout engine may be Rust compiled to WASM behind the `LayoutEngine` interface; nothing else needs to change.
