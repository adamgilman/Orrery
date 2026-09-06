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

Navigation (views, zoom, step-through, drill-down, morph) is what the runtime builds on top of those.

If something cannot be expressed in the model it is not a feature. If the tool has to know what "degraded" means,
or work out what a failure does to the rest of the system, the design is wrong: it is the author's diagram.
Specification: [docs/MODEL.md](docs/MODEL.md), with numbered invariants.

Three tests every release must pass:

1. **The README test.** The rendered SVG dropped into a GitHub README shows animated flow, with no plugin.
2. **The click-through test.** The *same file* opened directly in a browser is interactive with clicks and the
   keyboard alone: state changes, scenarios, views, drill-down. No panel; a page brings its own controls.
3. **The agent test.** An AI agent given only MODEL.md, the JSON Schema and the CLI can grow a model through the
   progressive walk (components, groups, connections, scenarios, views, own vocabulary), validating first time at
   each step, and gets the pictures it expected.

## 2. Users

| Role | Who | What they do |
|---|---|---|
| Author | AI coding agent (Claude Code, Cursor, etc.), occasionally a human | Writes `*.orrery.json`, runs `validate` and `render`, looks at the result with `yarn inspect` |
| Navigator | Engineer, architect, reviewer | Opens the interactive SVG or a page built on it, drills into groups, steps components through states, plays failure scenarios |
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
- **Runtime** (inside the SVG): an engine with no user interface of its own. Clicks and the keyboard work in the
  standalone file; a page mounts the engine and builds its own controls from the interface it exposes (views,
  scenarios, states, open and zoom as separate actions, play, change events with a snapshot).
- **What-ifs without a scenario**: `render --set <state>=<ids>`.
- **Exports**: `svg` (interactive, graceful in `<img>`), `--static`, per-scenario-step static; `png` and `gif`
  from the frame tooling (M4).
- **Agent surface**: MODEL.md, JSON Schema with a description on every property, `validate` with pointer errors
  and warnings, `render`, `export`, `embed`, later `explain`.
- **Vocabulary packs**: `"kinds": { "use": ["aws"] }` / `"states": { "use": "sre" }` pull in vocabularies shipped
  with the tool: the AWS, Google Cloud and Azure icon sets as kinds (`aws:s3`), and an SRE states set (docs/PACKS.md).

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
| `@orrery-diagrams/core` | JSON Schema, validator, declaration (scenario steps folded into the model), view scoping, `LayoutEngine` interface and fake engine, SVG renderer, document assembly | the model; pure, no DOM |
| `@orrery-diagrams/layout-elk` | `LayoutEngine` backed by elkjs | the one we expect to outgrow; nothing else imports elk (a test enforces it) |
| `@orrery-diagrams/runtime` | Vanilla JS inlined into the SVG: the engine (camera, state changes, scenarios, view morph, drill-down) and its interface, `window.Orrery.mount`. No panel. Budget 25 KB gzipped (currently ~6) | never React |
| `@orrery-diagrams/raster` | Freeze animation at time *t*, rasterise with a bundled font, frame diffs, `inspect` | frames are a pure function of (model, t), so no browser is needed |
| `orrery` (CLI) | `validate`, `render` (`--view`, `--static`, `--scenario`, `--step`, `--set`, `--play`, `--tour`, `--open`, `--zoom`), `export`, `embed`, `packs` | `node packages/cli/dist/main.js` today; `npx orrery` after publishing |

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
| Two paths out | `exports` in the model and `orrery export` write every picture as an enclosed file in one run; `orrery embed` writes the diagram, the engine (`window.Orrery.mount`, an interface with change events and snapshots) and a sample page that builds controls from it. The panel is gone: the standalone file is purely the diagram. Spec: docs/superpowers/specs/2026-09-05-two-paths-design.md. |
| Vocabulary packs | `kinds.use` / `states.use` merge a pack shipped with the tool before the author's own definitions. `aws`, `azure` and `gcp` turn the providers' official icon sets into kinds (every icon, derived names plus aliases, a few provider-coloured group frames), built by `tools/packs/build.mjs` and committed; `sre` is a states vocabulary. Glyphs gained an icon object form drawn as a nested `<svg>`; kind names may carry a namespace colon. `orrery packs` lists them. Provider terms in docs/PACKS.md. |
| Shapes | A `shapes` vocabulary next to `states` and `kinds`: eleven presets (box, sharp, pill, ellipse, cylinder, hexagon, diamond, parallelogram, document, card, cloud), the author's own as path data in a unit box with a declared pad, a kind naming one with `shape`. The default kinds bind database to cylinder, queue to parallelogram, gateway to hexagon, client to pill, external to cloud. Group kinds take a shape too: the frame open, the box closed, resized by rescaling the path in tours and the runtime morph. |
| Kitchen sink | examples/kitchen-sink/README.md draws every variant of the vocabulary, states, looks, kinds, frames, lines, shapes, packs and box details, from one model file per block, regenerated by `yarn examples`. |
| Moving parts | examples/moving-parts/README.md draws every way a model moves, views, open and zoom, cumulative scenario steps, what-ifs, play and the tour, from a model derived from the checkout master by `tools/moving-parts.mjs`. |
| Type pass | One scale on the 48px box (14 labels, 12 secondary, 11 eyebrow, 13 captions), Inter-first stack matching the frame tooling, closed-group names as peers of labels, legend and caption strips with air, tabular numerals. |
| Heading block | `description` on the model and on a view; `heading: true` on an export or `render --heading` draws title and description above the picture, centred or `left`, still or interactive (the runtime's camera works below it). |
| Callouts | `callouts` on a scenario step, a tour scene, an export and the model: a note with a leader pointing at an entity or connection, placed where there is room or on a declared side, drawn per moment in stills, play, tours and the interactive file (every step's carried hidden, the current step's shown). |
| Landing and Pages | The landing page covers callouts, kinds/shapes/packs and headings and links the reference pages; `.github/workflows/site.yml` tests every push and pull request and publishes site/dist to GitHub Pages on every push to main, at https://adamgilman.github.io/Orrery/. |
| Orrery drawn in Orrery | `examples/orrery.orrery.json` models the tool with every feature; `test/orrery` is the regression (schema walked against the file), smoke (the built CLI) and integration (every export, the frame tooling, the runtime in a DOM) suite around it. |
| Performance ratchet | `test/perf`: a frozen benchmark model measured at every stage against `baseline.json` on the `perf-baseline` branch, which CI tightens itself on every push to main; deterministic metrics exact, timings with slack; pull requests may only be no worse. |
| Sequence views | `type: sequence` on a view: messages in order over declared connections, participants as the entities' own boxes in their states on lifelines, activations from call and reply, `play` reveals, the runtime steps them; the checkout and the diagram of Orrery each carry one (M3b, the sequence half; the walkthrough is reserved). |

### Roadmap (aligned to the model, 2026-09-05)

Ordered by how directly each item serves the thesis that the file is a model in the author's language.

| # | Deliverable | Done when |
|---|---|---|
| N1 | **Browser click-through by a human**; fix what only eyes can find (morph feel, camera, legend placement). Standalone file confirmed in Safari on 2026-09-06: tour, morphs, drill-down, clicks and keys all good. Still to look at: the embed's sample page, Chrome, a phone. | The user reports the interactive file works on desktop Safari/Chrome |
| N2 | **`orrery explain`**: the model and a scenario in prose, in the author's vocabulary ("Step 1: Orders DB fails. Checkout API is degraded: reads from the replica."). Agents self-check with it; humans read it. | Explain output for every fixture is snapshot-tested and reads as English |
| M3b | **Walkthrough view**: a sequence view's messages as a token moving along the topology, stepping through the runtime with the morph. (The sequence view shipped 2026-09-06.) | The same messages animate on the topology |
| M4 | **GIF/PNG export** from the frame tooling; `render --png/--gif`. | Confluence fallback documented with a real GIF; agents can look at their own output |
| M5 | **Launch**: docs site built from MODEL.md, examples gallery, MCP server exposing validate/render/explain/check, agent eval harness with retry counts, tags and neighbourhood views if the backlog still wants them. | Public |

Principles for adding anything: it must be expressible in the author's vocabulary, it must add or change a
numbered invariant in MODEL.md with a test, and it must never compute a state (B3).

## 8. Engineering rules

- **TDD, no exceptions.** Every behaviour lands as a failing test first. Order per feature: schema fixture (valid/invalid JSON) → unit test → snapshot/e2e. PRs without tests are not reviewed.
- **Test layers**: (1) validator tests driven by fixture files under `fixtures/valid` and `fixtures/invalid` with expected error pointers; (2) `core` tests use a `FakeLayoutEngine` that places nodes on a grid, so render tests never touch ELK; (3) `layout-elk` has a contract test asserting determinism and that every node/edge gets a position/route; (4) SVG snapshot tests; (5) CLI e2e via child process on the fixture files.
- **Determinism is tested**, not assumed: render twice, compare bytes.
- **Layout hints**: `direction` and declaration order are the only ones. More only if a real diagram cannot be fixed otherwise. No coordinates in the schema, ever.
- **ELK quarantine**: `elkjs` is imported by `@orrery-diagrams/layout-elk` only. A test enforces it.
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
3. **Package names resolved (2026-09-06):** `orrery` and the `@orrery` scope were taken on npm, so the CLI is `orrery-diagrams` (bin `orrery`) and the libraries `@orrery-diagrams/*`; releases go out on a `v*` tag through trusted publishing. Schema hosting domain (`orrery.dev`?) still open; the schema URL points at GitHub raw.

## 12. Language decision

**TypeScript, strict mode, Node 22+, Yarn 4 workspace, vitest.** Decided 2026-09-04. Escape hatch: a future custom layout engine may be Rust compiled to WASM behind the `LayoutEngine` interface; nothing else needs to change.
