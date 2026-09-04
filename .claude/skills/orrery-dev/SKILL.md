---
name: orrery-dev
description: Develop Orrery itself (the animated architecture diagram tool in this repo). Use for any change to packages/*, the schema, the renderer, layout, or examples. Covers the TDD rules, the render-inspect-look loop, and how to read frame output.
---

# Developing Orrery

Orrery turns a JSON model into a standalone animated SVG. You are changing the tool, not drawing a diagram.
North Star: a diagram is a model, not a picture. Every visual behaviour derives from the model.

## Rules that are enforced by tests (do not fight them)

- Failing test first, then code. `yarn test` builds every package and runs unit, contract, snapshot, pixel and CLI e2e tests.
- `elkjs` is imported only in `packages/layout-elk`. Everything else talks to the `LayoutEngine` interface.
- The schema never contains coordinates. Every schema property has a `description`.
- Rendering is deterministic: same input, same bytes. Same SVG, same PNG (fonts are bundled).
- Animation is a pure function of load and time (`flowDuration`, `FLOW_PERIOD` in `packages/core/src/render.ts`). Frame tooling depends on this.

## The loop

1. Write or change a test under `packages/<pkg>/test/`. Fixtures live in `fixtures/valid` and `fixtures/invalid` (invalid ones pair with `<name>.errors.json`).
2. `yarn test` until green. For renderer changes, review the snapshot diff before `yarn test -u`.
3. Look at the result:
   ```
   yarn inspect examples/three-tier.orrery.json      # or any .orrery.json / .svg
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

## Layout of the repo

| Path | What |
|---|---|
| `packages/core` | schema, validator, model, `LayoutEngine` + fake engine, SVG renderer |
| `packages/layout-elk` | the only ELK importer |
| `packages/raster` | freeze, rasterise, frames, contact sheet, `inspect` |
| `packages/cli` | `orrery validate` / `orrery render` |
| `tools/inspect.mjs` | the loop script above |
| `site/` | examples page (`node site/build.mjs`, `node site/serve.mjs 8080`) |
| `PRD.md` | scope, milestones, open questions |

## Adding a model feature (e.g. groups)

Schema (`packages/core/schema/v1.json`, with descriptions) → invalid/valid fixtures → validator test → `types.ts`
→ `toLayoutGraph` + `LayoutGraph` type → contract test → fake engine → ELK adapter → renderer test → renderer
→ `yarn inspect` on an example → commit. Never skip the fake engine; renderer tests must not depend on ELK.
