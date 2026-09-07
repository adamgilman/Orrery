# @orrery-diagrams/raster

Freeze Orrery animations at a moment and rasterise them, so a picture can be checked by a machine and looked at
by an agent: frames, contact sheets, pixel comparisons, and `inspect`, which decides whether an animated SVG
does what its model says. Rendering uses resvg with a bundled font, so output is identical on every machine.

```sh
npm install @orrery-diagrams/raster
```

```ts
import { inspect, renderFrames, contactSheet, freezeFrame, rasterize } from "@orrery-diagrams/raster";

const report = inspect(svg);            // { ok, size, connections: [{ key, load, periodic, moving }], steps, problems }
const frames = renderFrames(svg, { fps: 10, durationMs: 1000, scale: 2 }); // [{ tMs, png }]
const sheet = contactSheet(frames);     // one PNG of every frame, for eyes
const still = rasterize(freezeFrame(svg, 500)); // the picture at t = 500 ms, as PNG bytes
```

| Export | What |
|---|---|
| `freezeFrame(svg, tMs)` | The SVG with every CSS animation replaced by its state at that moment. |
| `rasterize(svg, { scale, background })` | PNG bytes. A cropped picture (a zoomed export) is drawn whole and cut to its viewBox in pixels. |
| `renderFrames`, `contactSheet` | A sequence of frozen frames, and a grid of them. |
| `inspect(svg, { fps, durationMs, scale })` | Freezes, rasterises and compares: every flow with load must move and repeat on its declared period; nothing else may change between frames. |
| `flowRegions`, `pulseRegions`, `viewBoxOf` | Where the moving parts are, in pixels, from the SVG's own markup. |
| `decodePng`, `cropPng`, `diffFrames`, `regionEquals`, `isolateFlow`, `activeView` | The pieces `inspect` is built from. |

`yarn inspect <file>` in the repository wraps this for a rendered file and writes the contact sheet to look at.

MIT.
