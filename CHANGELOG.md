# Changelog

Versions follow [semver](https://semver.org); every package in the workspace shares one version. Changes to the
model are also recorded, with their reasons, in the decisions log of [docs/MODEL.md](docs/MODEL.md).

## Unreleased

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
