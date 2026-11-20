# @orrery-diagrams/raster

Freeze Orrery animations at a moment and rasterise them: the PNG and the animated GIF the `orrery` command
writes, and the frames, contact sheets, pixel comparisons and `inspect` that let a machine check a picture and
an agent look at one. Rendering uses resvg with a bundled font, and the GIF writer is part of this package, so
output is identical on every machine.

```sh
npm install @orrery-diagrams/raster
```

```ts
import { inspect, renderFrames, contactSheet, freezeFrame, rasterize } from "@orrery-diagrams/raster";

const report = inspect(svg);            // { ok, size, connections: [{ key, load, periodic, moving }], steps, problems }
const frames = renderFrames(svg, { fps: 10, durationMs: 1000, scale: 2 }); // [{ tMs, png }]
const sheet = contactSheet(frames);     // one PNG of every frame, for eyes
const still = rasterize(freezeFrame(svg, 500)); // the picture at t = 500 ms, as PNG bytes

import { renderPng, renderGif, fitLoop } from "@orrery-diagrams/raster";
const png = renderPng(svg, { scale: 2 });              // the picture at rest
const gif = renderGif(svg, { scale: 2, fps: 10 });     // one loop of it, looping for ever
const { durationMs, stretch } = fitLoop(svg);          // the loop renderGif chose, and how far it moved a period
```

`svg` is an enclosed picture: what `render(model, engine)` returns, or `orrery render --static`, or one of
`orrery export`'s files. An interactive document is reduced to one first with `activeView`.

| Export | What |
|---|---|
| `freezeFrame(svg, tMs)` | The SVG with every CSS animation replaced by its state at that moment. |
| `rasterize(svg, { scale, background })` | PNG bytes. A cropped picture (a zoomed export) is drawn whole and cut to its viewBox in pixels. |
| `renderFrames`, `contactSheet` | A sequence of frozen frames, and a grid of them. |
| `renderPng(svg, { scale, background })` | The picture at rest, the frame at t = 0, as PNG bytes. |
| `renderGif(svg, { scale, fps, durationMs, background })` | One loop as an animated GIF: the frames of `fitLoop`'s picture, evenly spaced. `fps` is rounded to what a GIF can time (100/n). |
| `fitLoop(svg, { durationMs, maxMs })` | The loop of a picture, from the periods written in it: a playing view's or tour's whole cycle; else the shortest (up to 8 s) in which every flow and the pulse completes whole cycles, exactly if there is one, otherwise with each period moved to the nearest that fits (at most 5% when such a loop exists). Returns `{ durationMs, stretch, svg }`; the frame of that `svg` at `durationMs` is its frame at 0. |
| `encodeGif(pngs, { delayMs })` | PNG frames of one size to a looping GIF: one palette of at most 255 colours (all of them kept when the frames have that few; otherwise a median cut that keeps the most used colours exact), and after the first frame only the box around what changed. |
| `inspect(svg, { fps, durationMs, scale })` | Freezes, rasterises and compares: every flow with load must move and repeat on its declared period; nothing else may change between frames. |
| `flowRegions`, `pulseRegions`, `viewBoxOf` | Where the moving parts are, in pixels, from the SVG's own markup. |
| `decodePng`, `cropPng`, `diffFrames`, `regionEquals`, `isolateFlow`, `activeView` | The pieces `inspect` is built from. |

`yarn inspect <file>` in the repository wraps this for a rendered file and writes the contact sheet to look at.

MIT.
