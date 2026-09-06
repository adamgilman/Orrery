---
name: orrery-dev
description: Develop Orrery itself (the animated architecture diagram tool in this repo). Use for any change to packages/*, the schema, the renderer, layout, or examples. Covers the TDD rules, the render-inspect-look loop, and how to read frame output.
---

# Developing Orrery

Orrery turns a JSON model into a standalone animated SVG. You are changing the tool, not drawing a diagram.
North Star: a diagram is a model, not a picture. Everything in a picture derives from what the author wrote in the
model; nothing is inferred.

## Vocabulary

The file speaks the user's language: **components, connections, groups, states, kinds, views, scenarios**
(`docs/MODEL.md` is the specification, with numbered invariants). Internals below `toLayoutGraph` speak graph:
nodes and edges, and the SVG uses `data-node` / `data-edge` / `data-flow` (keyed by connection key). Keep that
boundary in `packages/core/src/measure.ts`; never let "node" or "edge" reach a user-facing message.

States and kinds are author-defined and nothing computes a state. `declare.ts` folds scenario steps and a what-if
into the model; the renderer reads only looks, glyphs, frames and lines. If you find yourself writing `=== "failed"`
anywhere, or deriving one entity's state from another's, stop: that is invariant B3.

## Rules that are enforced by tests (do not fight them)

- Failing test first, then code. `yarn test` builds every package and runs unit, contract, snapshot, pixel and CLI e2e tests.
- `elkjs` is imported only in `packages/layout-elk`. Everything else talks to the `LayoutEngine` interface.
- The schema never contains coordinates. Every schema property has a `description`.
- Rendering is deterministic: same input, same bytes. Same SVG, same PNG (fonts are bundled).
- Animation is a pure function of load and time (`flowDuration`, `FLOW_PERIOD` in `packages/core/src/render.ts`). Frame tooling depends on this.

## The loop

1. Write or change a test under `packages/<pkg>/test/`. Fixtures live in `fixtures/valid` and `fixtures/invalid` (invalid ones pair with `<name>.errors.json`). Run source-only suites without the build step with `ORRERY_SKIP_BUILD=1 yarn vitest run packages/core`.
2. `yarn test` until green. For renderer changes, review the snapshot diff before `yarn test -u`.
3. Look at the result:
   ```
   yarn inspect examples/checkout.orrery.json        # or any .orrery.json / .svg
   ```
   It writes `.orrery-inspect/<name>/`: `static.png` (t=0), `frame-NN.png`, `sheet.png` (all frames tiled), `report.json`, `rendered.svg`, and exits 1 on any problem. Open `sheet.png` with the Read tool and actually look: overlaps, labels on lines, arrowheads hidden, dashes not advancing between tiles.
4. Turn anything you saw into an assertion. Geometry goes in `packages/core/test/layoutContract.ts` (runs against every engine). Pixel facts go in `packages/raster/test`.
5. Rebuild the examples page when a render changes: `yarn examples && node site/build.mjs`.

## How the animation check works

`freezeFrame(svg, t)` rewrites each flow path's CSS animation into the exact `stroke-dashoffset` for time t.
`inspect` isolates one flow at a time, rasterises t=0, t=duration/2 and t=duration, and requires:
frame(duration) == frame(0) (timing matches the declared constant) and frame(duration/2) != frame(0) (it moves).
A zero-load edge must never change. If you change dash pattern, period or duration formula, update
`FLOW_DASH`/`FLOW_PERIOD`/`flowDuration` in core and the check follows automatically.

`inspect` also subtracts consecutive frames of the whole diagram (`diffFrames`): every changed pixel must lie inside
a flow region, so a node, label or base edge that moves between frames is a failure. `diffs.png` paints changed pixels
red over a faded frame; it is the fastest way to see what an animation change actually did.

## Model semantics

`declare()` in `packages/core/src/declare.ts` is the single source of truth (MODEL.md §5): the base model, then
scenario steps 1..k (set with reasons, restore, load) in order, then the what-if (`applySet()` underneath).
`stopFlows()` applies the one drawing rule: a connection touching an entity whose state has `flows: stop` is drawn
with load 0. Everything renders or plays `stopFlows(declare(...).model)`. Rendering never computes state; it reads
`state`, `reason` and connection `load` as declared. Any state whose look pulses gets `data-pulse="1"`, and
`freezeFrame` freezes every pulse rule; `inspect` treats pulsing boxes as allowed motion. Changing what a step can
say means: MODEL.md invariant first, then the test named there, then the code.

## Layout of the repo

| Path | What |
|---|---|
| `packages/core` | schema, validator, declaration (scenario steps folded into the model), view scoping, `LayoutEngine` + fake engine, SVG renderer, document assembly |
| `packages/layout-elk` | the only ELK importer |
| `packages/raster` | freeze, rasterise, frames, contact sheet, `inspect` |
| `packages/runtime` | the engine bundled into every rendered SVG: `window.Orrery.mount(svg)` returns the interface a page builds controls from; no panel |
| `packages/cli` | `orrery validate` / `render` / `export` (the model's `exports`, enclosed files) / `embed` (diagram + engine + sample page in `packages/cli/sample/`) / `packs` (list the vocabulary packs) |
| `tools/inspect.mjs` | the loop script above |
| `tools/packs/build.mjs` | regenerates `packages/core/packs/*.json` from the providers' icon sets (docs/PACKS.md); the outputs are committed, so re-run only for a new icon release and read the diff |
| `tools/frames.mjs` | frames of any animated file over a time window, every track frozen exactly (resvg, no browser) |
| `tools/layout-score.mjs`, `tools/layout-tune.mjs` | score a layout (bends, length, frame crossings) and sweep ELK options over the compound examples, so layout tuning is measured |
| `tools/browser-frames.mjs` | the same in headless Chromium (`PLAYWRIGHT_BROWSERS_PATH=$HOME/.cache/ms-playwright`): the check of record for camera and drill-down transitions, since it runs the real CSS engine |
| `site/` | examples page (`node site/build.mjs`, `node site/serve.mjs 8080`); landing page (`node site/landing/build.mjs [out.html] --theme clockwork\|planetarium`, themes in `site/landing/themes/`, structure and copy in the template) |
| `PRD.md` | scope, milestones, open questions |

## Adding a model feature (e.g. `tags` on entities)

`docs/MODEL.md` invariant with its test name → schema (`packages/core/schema/v1.json`, with descriptions) →
invalid/valid fixtures → validator test → `types.ts` → `declare` test and code if it changes what a step says → `toLayoutGraph`
and the layout contract if it changes geometry → fake engine → ELK adapter → renderer test → renderer →
`yarn inspect` on an example → commit. Never skip the fake engine; renderer tests must not depend on ELK.
