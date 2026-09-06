# Two paths out of one model

Date: 2026-09-05. Status: draft for review.

## The idea

An Orrery model produces two kinds of output.

1. **Scenes.** Many enclosed SVG files from one run, each a picture or an animation of one moment or story: the
   overview, a failure playing on a loop, the inside of a group, a tour. They go into READMEs, wikis, design docs.
   No script, no HTML: CSS animation only, so they play inside an image tag anywhere.
2. **An embeddable diagram.** One SVG carrying every view and every open configuration, plus a runtime engine with
   no user interface of its own, plus a sample page showing how to drive it. The reader's page owns the controls.

The standalone file, the SVG opened directly in a browser with no page around it, is purely standalone: clicks and
the keyboard, nothing else. The side panel and its `foreignObject` are removed. The SVG never contains HTML.

## Path A: scenes

### Model

A new top-level block, `exports`, next to `views`, `scenarios` and `tour`. Each entry names a file and describes
one render with fields the renderer already understands:

| Field | Meaning |
|---|---|
| `id` | File name without extension. Unique within `exports`. Required. |
| `view` | View id. Default: the first view. |
| `focus` | Group id to open (the closed groups above it open too). A still of the inside of a group. |
| `scenario`, `step` | A scenario moment, as `render --scenario --step`. |
| `set` | A what-if, as a scenario step's `set` (ids, lists, or ids with reasons). |
| `play` | Scenario id to play on a loop, as a view's `play`; `seconds` optional (default 3). |
| `tour` | `true` for the model's tour. Exclusive with the other fields except `id`. |

Validation (S16): ids unique; `view`, `focus`, `scenario`, `step`, `set`, `play` resolve as they do elsewhere;
`focus` is a group in the view's `collapse`; `tour` requires a tour; `play` and `scenario` are exclusive.

### CLI

`orrery export <file> [--out <dir>]` renders every entry to `<dir>/<id>.svg` (default `--out .`). Exit 1 with the
usual pointer messages if the file is invalid; the run is all or nothing. `render` stays for one-offs and gains
`--focus <group>` so an entry can be reproduced by hand.

### Renderer

`focus` becomes a static render option: `scopeModel(model, view, open)` with the focus chain, rendered as one
layer, no camera (the still is the open layout itself). Nothing else changes.

## Path B: the embeddable diagram

### CLI

`orrery embed <file> [--out <dir>]` writes:

- `<dir>/<name>.svg`: the document `render` produces today (all views, all open configurations, the model as JSON,
  the engine inlined so the file also works opened directly).
- `<dir>/orrery.js`: the engine as a plain script that defines `window.Orrery`.
- `<dir>/index.html` and `<dir>/app.js`: a sample page. It fetches the SVG, inserts it inline, calls
  `Orrery.mount`, and builds controls in plain HTML from what the engine reports: a view chooser, a scenario
  stepper with the step note, state buttons for the selected entity, drill-down buttons and a back button, play
  and stop for the tour. It is written to be thrown away.

### The engine's interface

```ts
const orrery = Orrery.mount(svg: SVGSVGElement, options?: { size?: { width, height } }): Orrery;

orrery.views: { id, title }[]            // what the model offers, for building controls
orrery.scenarios: { id, label, steps: number }[]
orrery.states: { name, description? }[]
orrery.groups: { id, label, closed: boolean }[]   // closed: openable in the current view

orrery.showView(id)                      // morph to a view
orrery.focus(groupId | null)             // open a closed group (and those above it) and close the camera on it
orrery.back()                            // one level out; false when already at the top
orrery.setScenario(id | null, step = 1); orrery.next(); orrery.prev()
orrery.setState(id, state); orrery.cycle(id, by = 1); orrery.reset()
orrery.select(id | null); orrery.zoomTo(id); orrery.fit()
orrery.play(); orrery.stop()             // the tour if the model has one, else the view's scenario
orrery.on("change", (s: Snapshot) => void): () => void   // returns an unsubscribe
orrery.snapshot(): Snapshot
orrery.destroy()

type Snapshot = {
  view: string; open: string[]; focus: string | null;
  scenario: { id: string; step: number; steps: number; note?: string } | null;
  states: Record<string, { state: string; reason?: string }>;   // every entity, as drawn
  selected: string | null; playing: boolean;
}
```

Every mutation ends by emitting `change` with a fresh snapshot. The engine keeps doing what it does inside the
diagram without any page code: a click steps an entity through the author's states (shift+click steps back), a
click on a closed group opens it, Escape steps back out, arrow keys move the selection, Enter zooms, digits switch
views, `[` and `]` step a scenario. Hover focus stays.

### Standalone

`render` (no `--static`) keeps producing the interactive document, and the inlined engine still auto-boots when
the file is opened directly. There is no panel: what the reader has is the diagram, the clicks and the keyboard
above. The `foreignObject` panel, its CSS and `buildPanel` are deleted.

## Order of work

1. **Standalone.** Remove the panel. Rename `boot` to `mount`, return the interface above, add `on`/`snapshot`,
   `focus`/`back`, `play`/`stop`, `groups`. Runtime tests drive everything through the interface and check
   snapshots after each mutation. The bundled runtime test (jsdom) checks `window.Orrery` and auto-boot.
2. **Scenes.** Schema, MODEL.md (§4.x `exports`, invariant S16), fixtures, validator, `--focus`, `export`
   command, CLI tests, the checkout's own `exports`, `tools/examples.mjs` uses `export`.
3. **Embed.** `embed` command writing the four files, the sample page, a jsdom test that loads the sample's
   `app.js` against the document and drives the engine through its controls.
4. **Docs.** README's "Interactive" paragraph becomes the two paths; landing "One file" section likewise; PRD.

## Not in scope

A `:target` no-script fallback (views and steps without JavaScript). Worth a separate design if strict content
security policies turn out to matter.

## Amendment, 2026-09-06: open and zoom are separate

`focus` is replaced everywhere by two declared actions. `open` is the list of closed groups drawn open, each with
its closed ancestors listed too; `zoom` is the entity the camera closes on (a scene) or the picture is cropped to
(an export). A scene can open two groups and stay zoomed out, open one then another, zoom in on one, zoom out. The
engine's interface has `open(ids)`, `zoom(id | null)` and `back()` (zoom out, then close the innermost); the
snapshot carries `open` and `zoom`. Inside the diagram a click opens a closed box, Enter or double-click zooms,
Escape zooms out then closes. The interactive file carries a layer per way the view's closed groups can be open
(S17, R11, R12 in MODEL.md).
