# Changelog

Versions follow [semver](https://semver.org); every package in the workspace shares one version. Changes to the
model are also recorded, with their reasons, in the decisions log of [docs/MODEL.md](docs/MODEL.md).

## 0.4.0 (2026-09-09)

Drawings that a reader can work: a group of replicas opens into one instance, an open group can be closed from the picture, and the basic pieces of a diagram, a person, a device, a computer and a house, come with the tool. Nothing an existing model says has changed meaning.

- `replicas` on a group, as on a component: the closed frame is stacked and carries the count, and opening it drills into one instance rather than all of them. The frames behind the front one take no clicks, so only the front one opens. A group and a component can now be repeated and drilled into at once, which needed one group per instance before (#34).
- An open group's frame is never narrower than its own title band, so a label can no longer run into the corner mark or off the frame. Engines are told the width the band needs; the ELK adapter takes it as side padding, since ELK honours a minimum size on a compound node in a rightward layout but not a downward one.
- An open group in the interactive file carries a collapse mark in its corner, the mirror of the expand mark on a closed one, and a click on that frame's own background, label or mark closes that one group. Before, closing was Escape only, which pops the zoom first and then walks back the whole stack rather than acting on the group the reader is looking at; a reader of a bare SVG had no way to know the key existed (#33). Shift-clicking a frame still walks its states. A still draws no mark, since nothing there can be clicked.
- The `cloud` shape is drawn with cubic curves instead of elliptical arcs, so it stays inside its box at every aspect ratio. An arc's bulge grew with the box, so a cloud-shaped node with a long label drew out through the frame of the group holding it (#31). A test now samples every preset shape at five aspect ratios and fails if one draws outside its box. The cloud's label clearance widened to match its new outline.
- A `user` vocabulary pack, with the tool: `user:user`, `user:device`, `user:computer` and `user:house`, the basic pieces a diagram needs beside its services, with `person`, `phone`, `laptop` and `home` among the aliases. The glyphs are derived from [Lucide](https://lucide.dev), merged to a single path and scaled into the glyph slot so they take the theme's stroke like the built-in ones; Lucide's ISC notice and Feather's MIT notice ship in `packages/core/NOTICES.md`.
- The five MIT packages ship the project's licence notice in their own directory, which is what the MIT licence requires of copies and what npm includes in a tarball. A test keeps every workspace carrying a manifest, a README and a notice, and keeps the changelog's Unreleased section single and first.

## 0.3.0 (2026-09-07)

A breaking release for library users: `@orrery-diagrams/core`'s root export is now its curated public API, and the root runs in a browser. For the command line nothing breaks: `--version`, stdin, and a second name for the command, `orrery-diagrams`. It also carries four fixes found in an outside review.

- `orrery --version`; a `<file>` of `-` reads the model from stdin; the command is installed as `orrery-diagrams` as well as `orrery`, since the package is `orrery-diagrams` (`orrery` on npm is someone else's). The Claude Code plugin is versioned with the packages, checked by a test and by the release workflow. The design notes moved from `docs/superpowers/specs` to `docs/design/notes` with an index (housekeeping from an outside review).
- Every package has a README, so its npm page says what it is for. The repository README's Status heading renders again and says what has shipped; PRD.md no longer lists GIF and PNG export as outputs that exist nor describes propagation as done. CI regenerates every example picture and fails when a committed one differs, so a renderer change cannot leave the README lying (found in an outside review).
- Core's root runs in a browser: the JSON Schema and the built-in `sre` pack are generated into code (`src/generated.ts`, from `schema/v1.json` and `packs/sre.json`, which stay the sources) instead of being read from disk at import time, and installed provider packs are looked up through Node's builtins only when a pack is named and only where Node is. A test bundles the root for the browser and validates in a context with no `process` (found in an outside review: the root was Node-only and the browser-safe subpaths existed by convention).
- Breaking for library users: `@orrery-diagrams/core`'s root export is now a curated public API (the model's types, `validate`, `declare`, `render`, `renderDocument`, `renderExport`, the packs, `sanitizeGlyph`, the `LayoutEngine` contract), pinned by a test. Everything else moved behind `@orrery-diagrams/core/internal` (and `/internal/<module>`), the fake layout engine behind `@orrery-diagrams/core/testing`; the `/flow`, `/looks`, `/shapes` subpaths are gone (found in an outside review: thirteen `export *` lines made test doubles, regex constants and layout internals semver-committed).
- `render({ open })` applies the rule the validator applies to an export's `open`: a group inside a closed group needs that group open too, and a component is named as not a group (found in an outside review).
- Runtime: `destroy()` in the middle of a morph no longer lets the morph's completion start a scenario autoplay or a camera tween after everything was stopped; nothing runs after destroy.
- Runtime: a tour scene that switches view and opens groups now opens them in the view it switched to; before, the open list was resolved against the view being left and silently opened nothing.
- Raster: `inspect` and the region maths read the viewBox's origin, so a zoomed export is measured where it is drawn instead of from (0, 0); flow regions are clipped to the picture. A flow whose line never enters the picture is not checked. The rasteriser draws a cropped picture whole and cuts the pixels to its viewBox, because resvg 2.6 aborts the process on any element needing its own layer (a marker, a nested icon, a fallback glyph) that lies wholly outside the canvas, which a zoomed export always has.
- A value that fails a union (`set` entries, `heading`, `use`, looks, glyphs, lines, frames) is reported against the branch its type was reaching for: a non-string reason says the reason must be a string, `heading: "middle"` lists the allowed words, and a type no branch takes gets the forms in words. The old picker took strings for the first branch and everything else for the second, which was wrong for any three-way union (found in an outside review).

## 0.2.1 (2026-09-07)

A security fix; upgrade if a model file you render can come from someone else.

- Security: a custom glyph's markup is parsed and rebuilt from an allowlist of drawing elements and attributes instead of being checked against a list of forbidden strings. The old check could be bypassed with an entity-encoded `javascript:` link (found in an outside review), and did not cover SMIL animation or links. The provider packs are rebuilt through the same parser.

## 0.2.0 (2026-09-07)

Three new packages: `@orrery-diagrams/pack-aws`, `@orrery-diagrams/pack-azure` and `@orrery-diagrams/pack-gcp`, the providers' icon sets under the providers' terms. A model that uses one installs it; core and the CLI no longer carry them.

- The providers' icon packs are separate packages under the providers' terms: `@orrery-diagrams/pack-aws`, `pack-azure`, `pack-gcp`, each with the terms as its LICENSE, installed by the model that uses one; core and the CLI ship only `sre`. A missing pack fails validation naming the package. `validate(model, { packs })` takes packs in code.
- Sequence views: `type: sequence` with `messages` over declared connections; participants as the entities' own boxes on lifelines; activations; `play` reveals; the runtime steps messages and reports `message`. A sequence is its own file: `render --view <sequence>` writes it alone, the default file carries the topology views, `embed` writes one file per sequence.

## 0.1.1

- Published through npm trusted publishing; no token in the release workflow. No code changes.

## 0.1.0

The first published release: `orrery-diagrams` (the `orrery` command) and `@orrery-diagrams/core`, `layout-elk`,
`runtime` and `raster`.

- A declared model: components, connections, groups, states, kinds, shapes, views, scenarios, callouts, a tour.
- Automatic, deterministic layout through ELK; standalone SVG output that animates in an image tag and is
  interactive when opened directly; `export` for many enclosed pictures from one run; `embed` for a page with the
  engine and a sample.
- Drill-down with closed groups, open and zoom as separate actions, one drawing that moves between layouts.
- Vocabulary packs: the AWS, Google Cloud and Azure icon sets as kinds; an SRE states set.
- Eleven shapes and shapes of your own; a heading block; callouts on a step.
