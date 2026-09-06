# Every variant, with what it renders as

Each block below is a complete, valid model or a fragment marked as such. The test suite validates every complete
block against the schema, so what is written here is what the tool accepts. Defaults are what a file gets when it
declares nothing; every name is the author's to override, extend or replace.

## States and looks

The default states: `on` (normal), `degraded` (warn, amber), `failed` (alert, red, pulsing outline, flow stops),
`off` (muted, dimmed and dashed, flow stops). A state is bound to a look and to whether flow continues; nothing else.
`flows: "stop"` is a drawing rule: connections touching a failed box show no traffic.

Looks: `normal`, `warn`, `alert`, `muted`, `highlight` (blue), or a style object with `stroke`, `fill`, `text`,
`dash`, `pulse`, `opacity`. Only what is set changes.

```json
{
  "states": {
    "default": "healthy",
    "replace": true,
    "define": {
      "healthy": { "look": "normal", "description": "Within SLO" },
      "impaired": { "look": "warn", "description": "Serving; redundancy or latency SLO breached" },
      "brownout": { "look": { "stroke": "#7c3aed", "fill": "#f5f3ff", "text": "#5b21b6", "pulse": true }, "description": "Serving with a feature switched off" },
      "planned": { "look": { "dash": true, "opacity": 0.6 }, "flows": "stop", "description": "On the roadmap, not built" },
      "outage": { "look": "alert", "flows": "stop", "description": "Customer-visible failure" },
      "drained": { "look": "muted", "flows": "stop", "description": "Deliberately out of rotation" }
    }
  },
  "components": [{ "id": "api", "label": "API", "state": "brownout" }]
}
```

The same five words are a pack: `"states": { "use": "sre" }` stands in for the defaults, and `define` merges onto it.
Defining an existing name overrides only the fields given; a new name extends; `replace: true` keeps only yours, and
then `default` must name one of them.

The legend lists every non-default state a picture uses, with its description: the reader learns the author's words.

## Kinds: glyphs, shapes, boxes

The default component kinds and what they draw:

| Kind | Glyph | Shape |
|---|---|---|
| `service` | none | box |
| `database` | database | cylinder |
| `queue` | queue | parallelogram |
| `cache` | cache | box |
| `gateway` | gateway | hexagon |
| `client` | client | pill |
| `storage` | storage | box |
| `function` | λ | box |
| `external` | none | cloud, dashed, pale |

A glyph is a preset name, SVG path data in a 16×16 box drawn with the theme's stroke, or an icon object with its
own colours (`viewBox` and `svg` markup; no script, foreignObject, image, style or event handlers). A box style
takes `dash`, `fill`, `stroke`.

```json
{
  "kinds": {
    "components": {
      "mainframe": { "glyph": "storage", "shape": "cylinder", "description": "z/OS LPAR" },
      "sidecar": { "glyph": "M2 2h12v12H2z", "box": { "dash": true } },
      "vault": { "glyph": { "viewBox": "0 0 16 16", "svg": "<circle cx=\"8\" cy=\"8\" r=\"6\" fill=\"#FF7A1A\"/>" } }
    }
  },
  "components": [
    { "id": "a", "label": "Ledger", "kind": "mainframe" },
    { "id": "b", "label": "Envoy", "kind": "sidecar", "tech": "1.31", "replicas": 3 },
    { "id": "c", "label": "Secrets", "kind": "vault", "description": "Owned by platform; rotated weekly", "meta": { "owner": "platform", "runbook": "https://example.com/vault" } }
  ]
}
```

`replicas` stacks the box with a count; `tech` is a second line; `description` is a tooltip; `meta` is free-form
and ignored by rendering.

## Packs: the providers' icons as kinds

`aws`, `gcp` and `azure` carry every service in each provider's official icon set, under a name derived from the
provider's file name and under the names people say. `orrery packs aws` lists them (`aws:s3`, `aws:lambda`,
`aws:rds`, `aws:dynamodb`, `aws:sqs`, `aws:sns`, `aws:eks`, `aws:cloudfront`, `gcp:run`, `gcp:cloudsql`,
`gcp:pubsub`, `gcp:gke`, `gcp:bigquery`, `azure:aks`, `azure:sql`, `azure:functions`, `azure:service-bus`,
`azure:key-vault`, `azure:blob` among them). Each pack also has group kinds as frames in the provider's colours:
`aws:vpc`, `aws:region`, `aws:availability-zone`, `aws:public-subnet`, `aws:private-subnet`, `gcp:project`,
`gcp:vpc`, `azure:resource-group`, `azure:vnet`, `azure:subnet`.

```json
{
  "kinds": { "use": ["aws"] },
  "groups": [{ "id": "vpc", "label": "Checkout VPC", "kind": "aws:vpc" }],
  "components": [
    { "id": "web", "label": "Storefront", "kind": "client" },
    { "id": "api", "label": "Checkout API", "kind": "aws:lambda", "group": "vpc" },
    { "id": "db", "label": "Orders", "kind": "aws:rds", "group": "vpc" },
    { "id": "assets", "label": "Assets", "kind": "aws:s3" }
  ],
  "connections": [{ "from": "web", "to": "api" }, { "from": "api", "to": "db" }, { "from": "api", "to": "assets" }]
}
```

Packs merge after the defaults and before the author's own definitions; override a pack kind by defining it. The
interactive file embeds only the kinds a model uses.

## Shapes

Presets: `box` (the default), `sharp`, `pill`, `ellipse`, `cylinder`, `hexagon`, `diamond`, `parallelogram`,
`document`, `card`, `cloud`. A component kind or a group kind names one with `shape`. Your own is path data in a
100×100 box plus `pad`, the room the label needs on each side; or a rounded rectangle by `corner` (px, or
`"round"` for a pill). Connections end at the bounding box, so a line into a diamond stops a little short.

```json
{
  "shapes": { "define": {
    "chevron": { "path": "M0 0H85L100 50 85 100H0L15 50Z", "pad": { "x": 16, "y": 0 }, "description": "A pipeline stage" },
    "box": { "corner": 2 }
  } },
  "kinds": {
    "components": { "stage": { "shape": "chevron" } },
    "groups": { "pipeline": { "shape": "cloud", "frame": { "stroke": "#0891b2" } } }
  },
  "groups": [{ "id": "p", "label": "Ingest pipeline", "kind": "pipeline" }],
  "components": [
    { "id": "a", "label": "Ingest", "kind": "stage", "group": "p" },
    { "id": "b", "label": "Enrich", "kind": "stage", "group": "p" }
  ],
  "connections": [{ "from": "a", "to": "b" }]
}
```

## Groups and frames

Default group kinds: `tier` (plain), `region` (dashed), `zone` (dotted), `cluster` (darker outline), `boundary`
(red dashed, no fill). A frame style object takes `stroke`, `fill`, `fillOpacity`, `dash`, `dotted`. Groups nest
to any depth, may be empty, may be connected, and have a state of their own: setting a region `off` does not set
its members; list them.

```json
{
  "kinds": { "groups": { "cell": { "frame": { "stroke": "#0891b2", "dash": true, "fill": "#ecfeff", "fillOpacity": 0.4 }, "description": "A deployment cell" }, "lab": { "frame": { "stroke": "#94a3b8", "dotted": true } } } },
  "groups": [
    { "id": "eu", "label": "EU", "kind": "region" },
    { "id": "cell-a", "label": "Cell A", "kind": "cell", "parent": "eu" },
    { "id": "cell-b", "label": "Cell B", "kind": "cell", "parent": "eu", "state": "off", "meta": { "cost-centre": "eu-1" } },
    { "id": "lab", "label": "Lab", "kind": "lab", "description": "Experiments; nothing production routes here" }
  ],
  "components": [{ "id": "a", "label": "API", "group": "cell-a" }, { "id": "b", "label": "API", "group": "cell-b" }],
  "connections": [{ "from": "a", "to": "cell-b", "kind": "replication" }]
}
```

## Connections and lines

Default connection kinds: `sync` (solid), `async` (dashed), `replication` (dotted), `dataflow` (heavy). A line
style object takes `stroke`, `width`, `dash` (an SVG pattern like `"6 5"`), `flow` (the colour of the moving
traffic). `load` 0..1 sets the speed and weight of the flow; 0 draws no flow. `label` sits on the line;
`bidirectional` puts an arrowhead at both ends; `id` lets a scenario step address the connection.

```json
{
  "kinds": { "connections": { "gossip": { "line": { "dash": "2 3", "stroke": "#0891b2", "width": 2, "flow": "#0891b2" }, "description": "Membership gossip" } } },
  "components": [{ "id": "a", "label": "Node A" }, { "id": "b", "label": "Node B" }, { "id": "c", "label": "Warehouse" }],
  "connections": [
    { "id": "ab", "from": "a", "to": "b", "kind": "gossip", "load": 0.4, "bidirectional": true, "label": "gossip" },
    { "from": "a", "to": "c", "kind": "dataflow", "load": 0.8, "label": "events" },
    { "from": "b", "to": "c", "kind": "async", "load": 0 }
  ]
}
```

## Views

One model, many drawings. `scope` drills into a group (it becomes the outer frame); `only` restricts to listed
entities (a group id means the group and everything in it); `direction` per view; `collapse` draws groups closed
(one box the size of a component, with an expand mark; connections re-attach to it; closed groups nest);
`play` cycles a scenario on a timer in that view. What lies outside a view is drawn as a ghost at the edge, so
nothing is dropped silently. A view may carry a `title` and `description` for the heading block.

```json
{
  "groups": [{ "id": "data", "label": "Data" }, { "id": "cache", "label": "Session cache", "kind": "cluster", "parent": "data" }],
  "components": [
    { "id": "web", "label": "Storefront", "kind": "client" },
    { "id": "api", "label": "API" },
    { "id": "db", "label": "Orders DB", "kind": "database", "group": "data" },
    { "id": "redis", "label": "Redis", "kind": "cache", "group": "cache" }
  ],
  "connections": [{ "from": "web", "to": "api" }, { "from": "api", "to": "db" }, { "from": "api", "to": "cache" }],
  "scenarios": [{ "id": "db-fails", "steps": [{ "set": { "failed": "db" } }] }],
  "views": [
    { "id": "overview", "title": "Overview", "type": "topology", "collapse": ["cache"] },
    { "id": "data", "title": "Data tier", "scope": "data", "direction": "down", "description": "The data tier alone; the API is a ghost." },
    { "id": "front", "only": ["web", "api"] },
    { "id": "loop", "play": { "scenario": "db-fails", "seconds": 3 } }
  ]
}
```

## Scenarios: steps, reasons, loads, callouts

Steps are cumulative. `set` puts entities in states: an id, a list, or ids with reasons (a reason is the tooltip).
`restore` returns entities to the base model. `load` moves traffic by connection `id` or by `from`/`to`.
`callouts` are notes drawn at that step only. Nothing is inferred: say what a failure does to each other entity.

```json
{
  "components": [
    { "id": "api", "label": "API" }, { "id": "db", "label": "Orders DB", "kind": "database" }, { "id": "replica", "label": "Read replica", "kind": "database" }
  ],
  "connections": [
    { "from": "api", "to": "db", "load": 0.6, "label": "writes" },
    { "id": "failover", "from": "api", "to": "replica", "load": 0 },
    { "from": "db", "to": "replica", "kind": "replication", "load": 0.2 }
  ],
  "scenarios": [{ "id": "db-fails", "label": "Primary fails", "steps": [
    { "note": "Orders DB goes down",
      "set": { "failed": "db", "degraded": { "api": "reads from the replica; writes are queued" } },
      "load": [{ "id": "failover", "load": 0.6 }],
      "callouts": [{ "at": "replica", "text": "Reads move here; writes queue until the primary is back" }] },
    { "note": "Recovered", "restore": ["db", "api"], "load": [{ "id": "failover", "load": 0 }] }
  ] }]
}
```

Render a moment with `render --scenario db-fails --step 1`; a what-if without a scenario with
`render --set failed=db`, or an export's `set`.

## Callouts

A short text pointing at an entity or a connection, drawn as a note with an arrowed leader. Placed on the side
with the most room, or on the `side` given (`top`, `right`, `bottom`, `left`). Standing callouts at the top level
are on every picture; a step's, a scene's or an export's belong to that moment.

```json
{
  "components": [{ "id": "a", "label": "Gateway", "kind": "gateway" }, { "id": "b", "label": "API" }],
  "connections": [{ "id": "in", "from": "a", "to": "b", "label": "HTTPS" }],
  "callouts": [
    { "at": "a", "text": "Terminates TLS; rate limits per tenant", "side": "top" },
    { "at": "in", "text": "mTLS inside the mesh" }
  ]
}
```

## Heading

`description` on the model and on a view. An export's `heading: true` (centred) or `"left"`, or `render --heading`,
draws the title and description above the picture. Off by default: a document introduces its pictures itself.

## Exports: the pictures one run writes

`orrery export app.orrery.json --out docs/` writes every entry to `<id>.svg`: enclosed files, CSS animation only,
no script, so each plays inside an image tag. Fields: `view`, `open` (closed groups drawn open, each with its
closed ancestors), `zoom` (crop to an entity), `scenario` and `step`, `set` (a what-if) with `callouts`, `play`
with `seconds`, `tour: true`, `heading`.

```json
{
  "groups": [{ "id": "cache", "label": "Session cache", "kind": "cluster" }, { "id": "node-a", "label": "Node A", "kind": "cluster", "parent": "cache" }],
  "components": [
    { "id": "api", "label": "API" }, { "id": "redis", "label": "Redis", "kind": "cache", "group": "node-a" }, { "id": "db", "label": "DB", "kind": "database" }
  ],
  "connections": [{ "from": "api", "to": "cache" }, { "from": "api", "to": "db" }],
  "views": [{ "id": "overview", "collapse": ["cache", "node-a"] }],
  "scenarios": [{ "id": "db-fails", "steps": [{ "set": { "failed": "db" } }] }],
  "tour": { "seconds": 4, "scenes": [{ "view": "overview" }, { "view": "overview", "open": ["cache"] }] },
  "exports": [
    { "id": "overview" },
    { "id": "inside-the-cache", "open": ["cache"] },
    { "id": "inside-node-a", "open": ["cache", "node-a"], "zoom": "node-a" },
    { "id": "db-failed", "scenario": "db-fails", "step": 1 },
    { "id": "what-if", "set": { "off": { "redis": "maintenance" } }, "callouts": [{ "at": "redis", "text": "Drained for a kernel patch" }] },
    { "id": "db-fails-play", "play": "db-fails", "seconds": 3 },
    { "id": "with-heading", "heading": true },
    { "id": "tour", "tour": true }
  ]
}
```

## The tour: one drawing that moves

Scenes on a timer: a view, which closed groups are `open` (with their closed ancestors), what the camera `zoom`s
on, a `scenario` moment or a `set`, `callouts`, a `note` as caption, `seconds` of its own. Opening and zooming
are separate actions. When every scene shares one view the file is one drawing that moves between layouts:
shared boxes slide, frames grow, what leaves fades, what arrives fades in. `views: [...]` is the shorthand for one
scene per view.

```json
{
  "groups": [{ "id": "cache", "label": "Session cache", "kind": "cluster" }],
  "components": [{ "id": "api", "label": "API" }, { "id": "redis", "label": "Redis", "kind": "cache", "group": "cache" }],
  "connections": [{ "from": "api", "to": "cache" }],
  "views": [{ "id": "overview", "collapse": ["cache"] }],
  "scenarios": [{ "id": "redis-dies", "steps": [{ "set": { "failed": { "redis": "out of memory" }, "degraded": { "api": "sessions load slowly" } } }] }],
  "tour": { "seconds": 4, "scenes": [
    { "view": "overview", "note": "The whole system. The cache is one box." },
    { "view": "overview", "open": ["cache"], "note": "Open the cache: the picture reflows." },
    { "view": "overview", "open": ["cache"], "zoom": "cache", "scenario": "redis-dies", "step": 1, "note": "Redis dies.", "callouts": [{ "at": "redis", "text": "Out of memory; sessions fall back to the database" }] },
    { "view": "overview", "scenario": "redis-dies", "step": 1, "seconds": 6, "note": "Close it: the closed box carries the state." }
  ] },
  "exports": [{ "id": "tour", "tour": true }]
}
```

## The interactive file and the embed

`orrery render app.orrery.json -o app.svg` writes one file with every view and every drill-down layer, the model
and the engine inside. Opened in a browser: arrows select, Enter zooms, `f` steps a state, `s` starts and cycles
scenarios, brackets step, digits switch views, Escape resets, a click steps a component through the states and
opens a closed group. `orrery embed app.orrery.json --out site/` writes the diagram, `orrery.js` (defining
`window.Orrery`) and a sample page that builds controls from `Orrery.mount(svg)`: `showView`, `open`, `zoom`,
`back`, `setScenario`, `next`, `prev`, `setState`, `play`, `stop`, `on("change")`, `snapshot()`.
