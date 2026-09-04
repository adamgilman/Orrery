# Orrery

> An orrery is a mechanical model of the solar system. You crank it and watch the parts move.

**Orrery makes architecture diagrams that are models, not pictures.** Written as JSON by AI agents,
laid out automatically, rendered to a single SVG that animates in a GitHub README with no plugin.

Orrery's first diagram is, naturally, an orrery.

![The solar system, as a service](examples/solar-system.svg)

*A plain SVG file in an image tag. Dash speed and thickness follow each edge's `load`: the Sun pours heat into Venus,
Earth gets a steady stream of sunlight, Mars a trickle of solar wind, and the Moon mostly gets tides.*

A more terrestrial example, a checkout service with tiers, a region, and a worker queue, is below.

## What it does

Every diagram below is a plain SVG in an image tag, small enough to read on a phone. Sources are in
[examples/readme](examples/readme).

**Node kinds.** A small fixed vocabulary, each with its own glyph: client, gateway, service, database, cache, queue,
function, storage, external.

![Node kinds](examples/readme/kinds.svg)

**Nested groups.** Tiers, regions, zones, clusters and trust boundaries, each with a distinct frame. The hierarchy is
also the outline for navigation.

![Nested groups](examples/readme/groups.svg)

**Edge kinds and load.** Sync, async, replication and dataflow edges are drawn differently. Load drives the speed and
weight of the flow.

![Edge kinds](examples/readme/edge-kinds.svg)

**Failure scenarios.** Edges declare dependencies and fallbacks. A scenario marks one node failed and the tool works out
the rest: the worker fails with the primary, the API degrades onto its replica, the web tier degrades behind the API,
and traffic moves off the dead paths. Healthy first, then one step into the scenario.

![Failover, healthy](examples/readme/failover.svg)

![Failover, primary failed](examples/readme/failover-db-fails.svg)

```sh
orrery render examples/readme/failover.orrery.json --scenario db-fails -o failed.svg
```

**Views.** One model, many drawings. A view can drill into a group and choose its own direction.

![Overview](examples/readme/views.svg)

![Billing only](examples/readme/views-billing.svg)

A larger example, a checkout service with three tiers, a region, an external provider and a database failover, is at
[examples/checkout.svg](examples/checkout.svg) and [examples/checkout-db-failover.svg](examples/checkout-db-failover.svg).

## Status

Milestone 2 of the [PRD](PRD.md): the diagram is a model. Next are the interactive runtime inside the SVG (outline,
zoom, click to fail, step-through, view morphing) and GIF export.

## Quick start

```sh
yarn install && yarn build
node packages/cli/dist/main.js validate examples/three-tier.orrery.json
node packages/cli/dist/main.js render examples/three-tier.orrery.json -o out.svg
```

## Writing a diagram

```json
{
  "$schema": "https://orrery.dev/schema/v1.json",
  "direction": "right",
  "groups": [ { "id": "data", "label": "Data", "kind": "tier" } ],
  "nodes": [
    { "id": "web", "label": "Web", "kind": "gateway" },
    { "id": "api", "label": "API" },
    { "id": "db", "label": "Orders DB", "kind": "database", "group": "data" }
  ],
  "edges": [
    { "from": "web", "to": "api", "load": 0.8, "label": "HTTPS" },
    { "from": "api", "to": "db", "load": 0.4 }
  ],
  "views": [ { "id": "overview" }, { "id": "data", "scope": "data", "direction": "down" } ]
}
```

The top level is the model: `groups`, `nodes`, `edges`. `views` are drawings of it; leave them out for one view of
everything, or add several and pick one with `render --view <id>`.

Rules an agent needs to know:

- Never write coordinates. Layout is automatic and deterministic; `direction` is the only hint.
- Node order in JSON is the order on the canvas within a rank, so put important things first.
- Kinds are a small fixed vocabulary. Nodes: service, database, queue, cache, gateway, client, storage, function, external.
  Groups: tier, region, zone, cluster, boundary. Edges: sync, async, replication, dataflow.
- Edge ids default to `from->to`. Two edges between the same nodes need explicit ids.
- `load` is 0 to 1. Zero hides the flow, one is the fastest and thickest.
- `dependsOn: true` on an edge means the source cannot work without the target; `"soft"` means it only degrades.
  `fallback: true` marks a standby edge that takes over when the dependency it covers is down. Name that dependency
  with `fallbackFor` when the source has more than one. Node `state` is on, off, degraded, or failed.
- Scenarios are ordered, cumulative steps that override states and loads. Propagation does the rest.
- Unknown properties are errors, on purpose. Run `validate` and fix what it lists: each line is a JSON pointer and a message.

The full schema lives at [packages/core/schema/v1.json](packages/core/schema/v1.json).

## Development

Test-driven, no exceptions. Every behaviour lands as a failing test first.

```sh
yarn test          # builds, then runs unit, contract, snapshot and CLI e2e tests
yarn typecheck
node test/preview.mjs out.svg out.png   # rasterise to look at a render
```

Layout runs through the `LayoutEngine` interface. The Eclipse Layout Kernel adapter in `packages/layout-elk`
is the only package allowed to import elkjs; a test enforces that so the engine can be replaced.

## License

MIT
