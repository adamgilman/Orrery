# PNG and GIF output

Date: 2026-11-13. Status: built 2026-11-13 (PRD milestone M4).

## The idea

Several places people share a diagram do not take an SVG: a chat preview, a forum post, a wiki that only embeds
rasters. The command writes the same pictures as a PNG (the picture at rest) or an animated GIF (one loop of it:
flow along connections, a playing scenario, a tour). Nothing new is drawn. The frame tooling already freezes the
SVG at any moment and rasterises it deterministically; a PNG is the frame at t = 0 and a GIF is a run of frames.

## Command line

```sh
orrery render app.orrery.json -o app.png                       # by the file's name
orrery render app.orrery.json --play db-fails -o fails.gif
orrery render app.orrery.json --png > app.png                  # or by a flag, for stdout or any file name
orrery export app.orrery.json --gif --out docs/                # every export, as <id>.gif (or --png)
```

- The format is the extension of the file `-o` names, or `--png` / `--gif`. Both exist because each covers a case
  the other cannot: the extension is what someone types without reading the help, and the flag is needed for
  stdout and for `export`, which names its own files. A flag and an extension that disagree are a usage error.
- A raster implies `--static`: the picture is the enclosed SVG the same options draw, so every option of `render`
  applies (`--view`, `--scenario`, `--set`, `--play`, `--tour`, `--open`, `--zoom`, `--heading`).
- `export` takes the format as a flag, one format per run, in place of SVG. Rejected: a `format` field on an
  export. An entry says what a picture shows; the same entry is wanted as an SVG in a README and as a GIF in a
  chat, so the format belongs to the run. It would also have been a schema change for no gain.
- Knobs: `--scale <n>` pixels per unit (default 2, at most 8), and for a GIF `--fps <n>` (default 10, 1 to 50)
  and `--duration <seconds>`. Giving one to a format it does not apply to is a usage error.

## The loop

An SVG's animation never has to end; a GIF's does, and where it restarts is the one place a reader sees a flaw.
Animation is a pure function of the model and time (R5) and every period is written in the SVG, so the loop is
computed, not guessed (`fitLoop`):

- A playing view or a tour has one whole cycle (steps × seconds; the scenes' total). That is the loop.
- A picture of flows has one period per load, `0.5 + (1 - load) × 2.5` seconds rounded to a tenth, and the pulse
  has 1.2 s. They are all in step again only at their least common multiple, which for the checkout overview
  (1, 1.5, 1.8 and 2.5 s) is 45 s: 450 frames for a picture whose motion is over in two. So the loop is the
  shortest, up to 8 s, in which every period fits a whole number of times; when there is none, the shortest that
  moves no period by more than 5%; when there is none of those either, the one that moves them least.
- Each flow and the pulse is then given the nearest period that divides the loop, written into a copy of the SVG,
  and the frames are frozen from that copy. The frame after the last is the first, exactly (tested in pixels).
  Rounding to the nearest divisor is monotonic, so a slower flow is never drawn faster than a quicker one.

For the checkout overview the loop is 7.2 s and the largest change is 4%. Inside a playing scenario the loop is
fixed by the scenario, and a slow flow can move more (2.5 s becomes 3 s in a 6 s loop); the step change is what
the reader watches there. Rejected: exact periods with a jump at the restart (every frame true to the SVG, and
the loop visibly hiccups once a cycle on every picture with more than one load), and the true common period (too
long and too large by an order of magnitude). The SVG's own periods are untouched.

A GIF counts time in hundredths of a second, so the frame rate is 100/n: `--fps 12` plays at 12.5. The loop is cut
into the nearest whole number of frames, evenly spaced over the loop, so the content always closes exactly and
the playback time is within half a frame of the loop.

## Encoding

- One palette for the file. A picture is flat colours plus the shades along edges, usually a few hundred to a few
  thousand distinct values. With at most 255 they are all kept. Otherwise a median cut over the colours, weighted
  by the root of how often each occurs, down to 255 boxes, and each box is stood for by the most used real colour
  in it, not an average: the page stays white, fills and lines keep their exact colours, and only antialiasing is
  approximated. The 256th entry means "as the frame before".
- After the first frame only the box around the pixels that changed is written, with the unchanged pixels inside
  it transparent; a frame identical to the one before extends that one's time instead.
- No dithering: it would make every frame differ everywhere and cost most of the saving above.
- Deterministic: no timestamps, no comment block, no randomness; colours are sorted, ties are broken by value.

The writer is about 120 lines in `packages/raster/src/gif.ts`: the container, LZW with a hash table, the median
cut. A dependency was the first choice and `gifenc` (MIT, pure JavaScript, no dependencies) was built against
first. Two things decided against it. Its quantiser is marked as modified from PnnQuant.js, which is published
under MPL-2.0 and itself credits earlier work, so the provenance of the one part we needed most was not plainly
permissive; and it writes every frame at full size, with no way to give a frame a position. The test suite
decodes what the writer produces with a reader written separately from the GIF89a specification
(`packages/raster/test/gifDecode.ts`), including noise that fills and clears the code table repeatedly.

## Packaging

`orrery-diagrams` now depends on `@orrery-diagrams/raster`. Measured with npm on a cold cache: the install grows
from 19 MB to 28 MB (resvg's binary 3.9 MB, fast-xml-parser and its helpers 2.8 MB, pngjs 1 MB, the fonts 0.8 MB)
and takes 1.4 s instead of 1.2 s. The alternative, leaving raster out and asking for
`npx -p orrery-diagrams -p @orrery-diagrams/raster orrery …`, saves that and makes the feature one most people
would not find; the point of it is that `-o app.gif` works the first time.

The command imports raster only when a PNG or GIF is asked for, so the commands that write SVG start as fast as
before (0.26 s for the checkout). resvg installs its binary as an optional dependency per platform; where there
is none the install still succeeds, SVG output works, and a PNG or GIF fails with a message that names the
package and the reason.

## Defaults and what they cost

Scale 2 and 10 frames a second. The checkout's pictures (`orrery export examples/checkout.orrery.json`):

| Picture | Loop | GIF at scale 2 | GIF at scale 1 | PNG at scale 2 |
|---|---|---|---|---|
| overview (flows) | 7.2 s | 186 KB | 87 KB | 45 KB |
| primary-fails (a playing scenario) | 6 s | 228 KB | 105 KB | 52 KB |
| inside-node-a (a zoomed still, flows) | 7.2 s | 28 KB | 13 KB | 21 KB |
| drill-down (the tour) | 28 s | 4.3 MB | 1.8 MB | 66 KB |

A picture of flows or a scenario takes two to five seconds to write. The tour is the heavy case: 280 frames of a
drawing a thousand units tall take over a minute at scale 2, and `--scale 1` or `--fps 5` is the answer there.

## Invariant

R19: a PNG or a GIF is a raster of the enclosed SVG the same options draw; same model, same bytes; a GIF is one
loop whose last frame is followed by its first.

## Not done

- A dark or transparent background. Pictures are rasterised on white, as `rasterize` does.
- A PNG of a moment other than rest. A scenario step is already a still (`--scenario --step`); a moment inside a
  tour is not reachable from the command line (the frame tooling reaches it: `tools/frames.mjs`).
- APNG, WebP or video.
