# @orrery-diagrams/core

The Orrery model: the JSON Schema, the validator, a moment of the model, view scoping, packs, shapes and the SVG
renderer. Everything the `orrery` command does is a call into this package, and it runs in Node 22+ and in a
browser. The model is specified in [docs/MODEL.md](https://github.com/adamgilman/Orrery/blob/main/docs/MODEL.md).

```sh
npm install @orrery-diagrams/core @orrery-diagrams/layout-elk
```

```ts
import { validate, render, renderDocument, renderExport } from "@orrery-diagrams/core";
import { ElkLayoutEngine } from "@orrery-diagrams/layout-elk";

const r = validate(JSON.parse(await readFile("app.orrery.json", "utf8")));
if (!r.ok) for (const e of r.errors) console.error(e.toString()); // "/components/2/kind: unknown kind ..."
else {
  const still = await render(r.model, new ElkLayoutEngine(), { view: "overview", scenario: "db-fails", step: 1 });
  const interactive = await renderDocument(r.model, new ElkLayoutEngine(), { runtime: RUNTIME_SOURCE }); // from @orrery-diagrams/runtime
  for (const x of r.model.exports) await writeFile(`${x.id}.svg`, await renderExport(r.model, new ElkLayoutEngine(), x));
}
```

## The public API

The root export is the whole of what semver covers, and a test pins the list:

| Export | What |
|---|---|
| the model's types | `Model`, `Component`, `Connection`, `Group`, `View`, `Scenario`, `Export`, `Pack`, ... |
| `validate(input, { packs? })` | The schema, then every rule of the specification, with pointer-addressed errors and warnings; returns the normalised model. `packs` hands over vocabularies in code, for a browser or a bundler. |
| `schema` | The JSON Schema, as an object. |
| `declare(model, { scenario?, step?, set? })` | One moment of the model: the states, reasons and loads a scenario step or a what-if declares, applied. |
| `render`, `renderDocument`, `renderExport` | A still of one view, the interactive file with every view and drill-down embedded, or one entry of the model's `exports`. |
| `loadPack`, `packNames`, `packProblem`, `installHint`, `PROVIDER_PACKS` | The vocabulary packs: `sre` is built in; the providers' icon packs are their own packages under the providers' terms. |
| `sanitizeGlyph` | A custom icon's markup, rebuilt from an allowlist of drawing elements and attributes. |
| `LayoutEngine`, `LayoutGraph`, `LayoutResult` | The contract a layout engine implements: a graph of measured boxes in, positions and routes out. |
| `ModelError`, `ValidationError`, `ValidationWarning` | What the calls throw or return. |

Two more entry points exist and are not promised by semver:

- `@orrery-diagrams/core/internal` (and `/internal/<module>`): the renderer's parts, for the runtime, the raster and the tools: defaults, measurement, view scoping, flow timing, looks, shapes, the sequence layout.
- `@orrery-diagrams/core/testing`: `FakeLayoutEngine`, a layout engine that lays out without ELK, for tests.

## Packs

A model says `"kinds": { "use": ["aws"] }` and names kinds like `aws:s3`. The `aws`, `azure` and `gcp` packs are
separate packages, `@orrery-diagrams/pack-aws` and so on, because the icons are the providers' and come under their
terms rather than this package's MIT licence; installing one is accepting those terms. A missing pack fails
validation naming the package to add. See [docs/PACKS.md](https://github.com/adamgilman/Orrery/blob/main/docs/PACKS.md).

## Licence

MIT. The provider icon packs are not part of this package.
