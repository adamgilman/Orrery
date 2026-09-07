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
orrery embed app.orrery.json --out site/              # the diagram, the engine and a sample page for your own page
orrery packs aws                                      # every kind a vocabulary pack defines
orrery --help                                         # every option
```

Layout is automatic; the file never contains coordinates. Every property of the model is described in the JSON
Schema (`@orrery-diagrams/core/schema/v1.json`) and specified in
[docs/MODEL.md](https://github.com/adamgilman/Orrery/blob/main/docs/MODEL.md). The providers' icon packs are
separate packages under the providers' terms: `npm install @orrery-diagrams/pack-aws`, then `"kinds": { "use": ["aws"] }`.

Node 22 or newer. MIT.
