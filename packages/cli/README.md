# orrery-diagrams

Animated, navigable architecture diagrams from a JSON model, built for AI agents to author. This is the `orrery`
command; the model and the renderer are `@orrery-diagrams/core`, the layout engine `@orrery-diagrams/layout-elk`,
the in-file engine `@orrery-diagrams/runtime`. The whole story, with pictures, is in the
[repository README](https://github.com/adamgilman/Orrery#readme).

```sh
npm install -g orrery-diagrams        # or: npx orrery-diagrams …
```

```sh
orrery validate app.orrery.json                       # OK: 6 components, 7 connections, ... or one pointer-addressed error per line
orrery render app.orrery.json -o app.svg              # one SVG: animated in an <img>, interactive when opened directly
orrery render app.orrery.json --static -o app.svg     # one view, no runtime
orrery render app.orrery.json --view checkout-seq -o seq.svg   # a sequence view, a file of its own
orrery render app.orrery.json --scenario db-fails --step 1     # a still of that moment
orrery export app.orrery.json --out docs/             # every picture the model's `exports` lists
orrery render app.orrery.json -o app.png              # a PNG of the picture at rest, for where an SVG is not taken
orrery render app.orrery.json --play db-fails -o fails.gif     # an animated GIF: one loop of flow, a scenario or a tour
orrery export app.orrery.json --gif --out docs/       # every export as <id>.gif (or --png)
orrery embed app.orrery.json --out site/              # the diagram, the engine and a sample page for your own page
orrery packs aws                                      # every kind a vocabulary pack defines
orrery --help                                         # every option
```

PNG and GIF are chosen by the name after `-o`, or by `--png` and `--gif` (which also write to stdout). Both draw
what `--static` draws, on white, with fonts that come with the tool, so the same model gives the same bytes on
every machine. `--scale <n>` sets pixels per unit (default 2); for a GIF, `--fps <n>` sets frames a second (default
10) and `--duration <seconds>` the length of the loop. Left alone, the loop is the playing scenario's or the tour's
whole cycle, or for a picture of flows a few seconds in which every flow completes whole cycles, each period moved
a few percent to fit, so the GIF repeats without a jump. A typical picture is 100 to 400 KB; a long tour at the
default scale is several megabytes and takes a minute or more; `--scale 1` more than halves both. The rasteriser,
`@orrery-diagrams/raster`, is installed with the command and loaded only when a PNG or GIF is asked for.

Layout is automatic; the file never contains coordinates. Every property of the model is described in the JSON
Schema (`@orrery-diagrams/core/schema/v1.json`) and specified in
[docs/MODEL.md](https://github.com/adamgilman/Orrery/blob/main/docs/MODEL.md). The providers' icon packs are
separate packages under the providers' terms: `npm install @orrery-diagrams/pack-aws`, then `"kinds": { "use": ["aws"] }`.

Node 22 or newer. MIT.
