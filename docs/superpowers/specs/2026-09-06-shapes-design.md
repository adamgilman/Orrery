# Shapes

Date: 2026-09-06. Status: built 2026-09-06.

## The idea

Every component is drawn as one rounded box today; the glyph does all the telling. A shape is the outline of a
component's box, and it joins the vocabulary the way states and kinds did: presets by name, the author's own
definitions in a block, a kind naming one, packs able to carry them. Nothing on a component itself; the kind is
where the picture lives.

```jsonc
"shapes": {
  "define": {
    "chevron": { "path": "M0 0H85L100 50 85 100H0L15 50Z", "pad": { "x": 16, "y": 0 }, "description": "A stage in a pipeline" },
    "box":     { "corner": 2 }                                     // override a preset
  }
},
"kinds": { "components": { "stage": { "shape": "chevron" }, "ledger": { "shape": "cylinder", "glyph": "database" } } }
```

## Model

- `shapes.define` binds names to outlines. A name is a preset (below), a new name (extends), or an existing one
  (overrides the fields given). `replace: true` keeps only the author's, and `box` must then be among them, since
  a kind that names no shape is drawn as `box`.
- An outline is one of: `path`, SVG path data in a 100 by 100 unit box, or `corner`, a rounded rectangle with
  that corner radius in px, or `"round"` for a pill. Exactly one of the two.
- `pad` is the extra room the label needs to clear the outline, `{ x, y }` in px each side, default 0. Declared,
  not computed.
- `kinds.components.<name>.shape` names a shape. Unknown names are errors at `/kinds/components/<name>/shape`.
- A pack's `shapes.define` comes in with `kinds.use`, prefixed like its kinds.

## Presets

| Name | Outline | Pad |
|---|---|---|
| `box` | rounded rectangle, corner 8 (the default) | 0, 0 |
| `sharp` | rectangle, corner 0 | 0, 0 |
| `pill` | corner `round` | 6, 0 |
| `ellipse` | two arcs | 18, 8 |
| `cylinder` | body with elliptical caps, the top cap drawn | 6, 6 |
| `hexagon` | flat top and bottom, pointed sides | 16, 0 |
| `diamond` | | 36, 14 |
| `parallelogram` | leaning right | 14, 0 |
| `document` | wavy bottom edge | 0, 8 |
| `card` | top-left corner cut | 4, 0 |
| `cloud` | six bumps on a flat base | 16, 12 |

Default kinds rebound: `database` → cylinder, `queue` → parallelogram, `gateway` → hexagon, `client` → pill,
`external` → cloud (still dashed). `service`, `cache`, `storage`, `function` stay `box`.

## Rendering

The outline carries the class `node-box`, as the rect did, so every state, kind and ghost rule keeps working. A
`corner` shape is a `<rect rx>`; a `path` shape is a `<path d>` whose coordinates are scaled from the unit box to
the measured size, command by command (arcs scale their radii), so stroke widths stay true and nothing is
transformed. Replica stacks draw the same outline twice behind, offset, as `replica-box`. The glyph slot and label
move in by `pad.x`; measurement adds `2·pad` to width and height. Tour variants reuse the body, so a state variant
carries its shape. Connections still end at the bounding box, so a line into a diamond stops a little short of the
outline; a later slice may trim to the outline.

## Tests

- Normalisation: the eleven presets exist; default kinds carry their shapes; define, override, replace; the error
  cases (unknown shape on a kind, bad path, both or neither of path and corner, replace without box).
- Measure: a diamond is wider and taller than a box with the same label.
- Path scaling: absolute and relative commands, H/V, arcs, rounding to 0.1.
- Render: cylinder as a scaled path with class `node-box`; pill rect with `rx` = half the height; a custom shape
  from `shapes`; the label and glyph moved in by the pad; replica stack as `replica-box` copies.
- Fixture `shapes.json` draws every preset and one custom shape (also on the examples page).

## Docs

MODEL.md: a vocabulary row, `shape` in 4.8 with a Shapes paragraph, S15 and a new R14, a decision. README stage 1
names the shapes. Schema descriptions say the same.
