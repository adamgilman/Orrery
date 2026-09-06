# Changelog

Versions follow [semver](https://semver.org); every package in the workspace shares one version. Changes to the
model are also recorded, with their reasons, in the decisions log of [docs/MODEL.md](docs/MODEL.md).

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
