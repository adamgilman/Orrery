# The Orrery model

Version 1 (draft, 2026-09-05). This document is the specification. The JSON Schema in
`packages/core/schema/v1.json` enforces the structure; the validator and the propagation engine enforce the
invariants listed in section 6; every invariant names the test that proves it. When this document and the code
disagree, the code has a bug.

## 1. Philosophy

- **A diagram is a model, not a picture.** Everything visible derives from the model. Nothing is placed by hand.
- **One model, many views.** The file describes what exists once. Views are drawings of it; scenarios are stories
  told over it. Both refer to the model by id and can introduce nothing.
- **Users' words, not graph words.** Components, connections, groups. Never nodes, edges, vertices.
- **Progressive.** Components alone are a valid file and render. Every other field is an enrichment that adds a
  visible or behavioural change the author can see on the next render.
- **Three layers: vocabulary, representation, mechanics.** The author owns the vocabulary: the names of
  states, of component kinds, of group kinds, and what they mean. The renderer owns representation: looks,
  glyphs, frames, either presets or author-defined. The engine owns mechanics: rank, availability, flow, cascade,
  counting. Defaults exist for all three so a small file stays small, and every default can be extended or
  replaced. No rule in the engine or renderer names a state or a kind.
- **Explicit over inferred.** Dependencies are declared by the author (`needs`). The engine never guesses that a
  connection implies a dependency, that a database is a fallback for another database, or what "primary" means
  from a label.
- **Connections are fluid.** Any entity can connect to any other entity: component to component, component to
  group, group to group, including empty groups. An empty group is a black box you have not opened yet.
- **Small vocabulary.** Every enumerated value has a glyph or style and a meaning that holds across views.
- **Written by agents, read by humans.** Every property has a description in the schema. Unknown properties are
  errors. Errors carry a JSON pointer and a sentence.

## 2. A file, growing

```jsonc
// Step 1: components render as boxes.
{ "components": [ { "id": "web" }, { "id": "api" }, { "id": "db", "kind": "database" } ] }

// Step 2: connections render as arrows with flow.
{ "components": [ /* ... */ ],
  "connections": [ { "from": "web", "to": "api" }, { "from": "api", "to": "db", "load": 0.6 } ] }

// Step 3: a need makes the connection matter. `orrery render --fail db` shows the consequence.
{ "id": "api", "needs": ["db"] }

// Step 4: alternatives. `--fail db` now degrades the API instead of failing it, and load moves to the replica.
{ "id": "api", "needs": [ { "any": ["db", "replica"] } ] }

// Step 5: a scenario records a sequence of what-ifs as verbs.
{ "scenarios": [ { "id": "db-failover", "steps": [
    { "note": "Primary goes down", "fail": "db" },
    { "note": "Recovered",         "restore": "db" } ] } ] }

// Step 6: views drill into groups and choose a direction.
{ "views": [ { "id": "overview" }, { "id": "data", "scope": "data", "direction": "down" } ] }
```

## 3. Vocabulary

| Word | Meaning | Not |
|---|---|---|
| **entity** | A component or a group. Anything that can be connected, needed, failed, or shown. | |
| **component** | A running thing in one place: a service, database, queue, client, external system. Two deployments of the same code in two regions are two components. | A codebase, a team, a class |
| **connection** | Something one entity does to another: calls it, publishes to it, replicates to it, streams data to it. Directed from the initiator to the target. Either end may be a component or a group. | A dependency (that is a need) |
| **group** | A container that means something: a tier, a region, a zone, a cluster, a trust boundary, or a whole system you have not opened yet. Groups nest and may be empty. A group can be connected, needed and failed like a component. | A layout hint |
| **need** | What a component cannot work without, declared on that component, satisfied by one or more alternative entities. | A connection |
| **view** | One drawing of the model: a scope, a subset, a direction. | A second model |
| **scenario** | An ordered, cumulative sequence of what-ifs: fail, degrade, switch off, restore, shift load. | A test |
| **state** | A named condition an entity can be in, declared in the model or a scenario, then propagated. State names are the author's; each is bound to a look and to mechanics (4.8). The default set is `on`, `degraded`, `failed`, `off`. | A metric, a fixed meaning |
| **look** | A visual treatment for a state: a preset (`normal`, `warn`, `alert`, `muted`, `highlight`) or an author-defined style. | A state |
| **kind** | A vocabulary word for what a component or group is, bound to a glyph or a frame style. Defaults provided, extensible, replaceable. | A behaviour |
| **load** | Relative traffic on a connection, 0 to 1. Drives animation only. | Requests per second |

## 4. Entities

Ids: `^[A-Za-z0-9][A-Za-z0-9_.-]*$`. Components and groups share one id space. Ids are stable handles for
references; labels are for people and default to the id.

### 4.1 Document

| Field | Type | Default | Meaning |
|---|---|---|---|
| `$schema` | string | | Schema URL, for editor support. |
| `title` | string | | Title of the system. Shown on the default view. |
| `direction` | `right` \| `down` | `right` | Default flow direction for views. The only layout hint at this level. |
| `components` | array | required | See 4.2. At least one. |
| `connections` | array | `[]` | See 4.3. |
| `groups` | array | `[]` | See 4.4. |
| `views` | array | one view of everything | See 4.5. |
| `scenarios` | array | `[]` | See 4.6. |

### 4.2 Component

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | id | required | |
| `label` | string | id | Display name. |
| `kind` | kind name | `service` | What it is; picks the glyph and box style via `kinds` (4.9). Default set: `service` `database` `queue` `cache` `gateway` `client` `storage` `function` `external`. No mechanics. |
| `group` | id | | The group it sits in. Omit for top level. |
| `state` | `on` `degraded` `failed` `off` | `on` | Declared health in the base model. `off` is intentional (maintenance, decommissioned) and drawn dimmed; `failed` is broken and drawn red; `degraded` is partially working and drawn amber. |
| `needs` | array of need | `[]` | See 4.7. |
| `replicas` | integer ≥ 1 | 1 | How many instances. Drawn as a stacked box with a count. No health semantics in v1. |
| `tech` | string | | Technology, drawn as a sublabel: "PostgreSQL 16". |
| `description` | string | | Shown as a tooltip and in the outline. |
| `meta` | object | | Free-form, ignored by rendering and semantics. Owner, URL, tags, cost centre. |

### 4.3 Connection

| Field | Type | Default | Meaning |
|---|---|---|---|
| `from`, `to` | id | required | Entity ids (component or group). Direction is who initiates. A connection to a group attaches to its frame (R7). |
| `id` | id | | Only needed when the same pair has more than one connection and something refers to them. |
| `kind` | `sync` `async` `replication` `dataflow` | `sync` | How it is drawn. Carries no health semantics. |
| `label` | string | | Short text on the line: protocol, purpose. |
| `load` | 0..1 | 0.5 | Relative traffic; speed and weight of the flow. 0 hides the flow. |
| `bidirectional` | boolean | false | Arrowheads at both ends. Flow still animates from `from` to `to`. |
| `meta` | object | | Free-form. |

A connection is referenced (in scenarios) by `{ "from", "to" }` or, when that pair is ambiguous, by `{ "id" }`.

### 4.4 Group

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | id | required | |
| `label` | string | id | Frame title. |
| `kind` | kind name | `tier` | Frame style via `kinds` (4.9). Default set: `tier` `region` `zone` `cluster` `boundary`. No mechanics. |
| `parent` | id | | Enclosing group. |
| `state` | state name | `states.default` | Declared state of the group as an entity: what needs and connections on the group see. Reaches members only if the state's `cascade` says so (4.8). For an empty group this is its only state. |
| `description` | string | | Tooltip and outline text. |
| `meta` | object | | Free-form. |

An empty group is valid and is drawn as a frame of minimum size: a black box. Add members later and every
connection and need pointing at it keeps working.

### 4.5 View

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | id | required | Used by `render --view`. |
| `title` | string | document title | |
| `type` | `topology` | `topology` | `sequence` and `walkthrough` are reserved. |
| `direction` | `right` \| `down` | document direction | |
| `scope` | group id | | Drill in: the group is the outer frame; its descendants and the connections among them are shown. |
| `only` | array of entity id | | Restrict to these entities; a group id means the group and all its descendants. Groups containing a selected entity are shown. Combines with `scope` by intersection. |

Connections with exactly one end inside a view are drawn to a ghost of the outside component at the view's edge
(rendering rule R4). Nothing is silently dropped.

### 4.6 Scenario

| Field | Type | Meaning |
|---|---|---|
| `id` | id | |
| `label` | string | Defaults to id. |
| `steps` | array of step, at least one | Cumulative: the state at step *k* is the base model with steps 1..*k* applied in order. |

Step:

| Field | Type | Meaning |
|---|---|---|
| `note` | string | What happens, shown during step-through. |
| `set` | object: state name → entity id or array | Set those entities' declared state: `"set": { "failed": "db", "off": ["eu-west"] }`. Any name from `states`. |
| `restore` | entity id or array | Return those entities to their base-model declared state. |
| `load` | array of `{ from, to, load }` or `{ id, load }` | Override a connection's load. Rarely needed: load shifts automatically when a need's alternative is unhealthy. |

A step must change at least one thing. The same entity may not appear under two states, or under `set` and
`restore`, in one step.

### 4.7 Need

A need is an entry in a component's `needs` array. Two forms:

- An entity id: a hard need with one way to satisfy it. `"needs": ["db"]` or `"needs": ["payments-platform"]`.
- An object: `{ "any": [ids...], "min": 1, "unmet": "failed", "reduced": "degraded" }`. `any` lists
  alternatives in order of preference. `min` is how many must be available for the need to be met (quorum).
  `unmet` names the state the component enters when fewer than `min` are available; `reduced` the state when the
  need is met but not every alternative is available. Both default from the document's `states` (4.8); a
  nice-to-have call is simply `"unmet": "degraded"`.

Every id in a need must be an entity that has a connection with the needing component, in either direction
(invariant S9). Needs are about availability; they add no lines to the drawing, they change what the existing
lines mean, and they are drawn as a cue on those lines (R3). A need on a group is the progressive form: need the
black box now, refine to the component inside it once the box is opened.

### 4.8 States

`states` binds the author's state names to representation and mechanics. The engine and renderer read only the
right-hand side; the names and their meanings are the author's.

```jsonc
"states": {
  "default": "on",                                   // the state of anything not declared otherwise
  "needs":   { "unmet": "failed", "reduced": "degraded" },   // outcome states needs use unless they say otherwise
  "replace": false,                                  // true: only the names below exist; the defaults are gone
  "define": {
    "on":       { "look": "normal", "rank": 0, "available": true },
    "degraded": { "look": "warn",   "rank": 1, "available": true },
    "failed":   { "look": "alert",  "rank": 2, "available": false, "flows": "stop" },
    "off":      { "look": "muted",  "rank": 2, "available": false, "flows": "stop", "cascade": "children" },
    "brownout": { "look": { "stroke": "#7c3aed", "fill": "#f5f3ff", "pulse": true }, "rank": 1, "available": true,
                  "description": "Serving with feature flags off" }
  }
}
```

The block above, minus `brownout`, is the default. Omitting `states` gives exactly it. Defining a name that
exists overrides it; defining a new name extends the set; `replace: true` discards the defaults, in which case
`default`, `needs.unmet` and `needs.reduced` must name states from `define`.

| Field | Meaning |
|---|---|
| `look` | A preset name (`normal`, `warn`, `alert`, `muted`, `highlight`) or a style object: `stroke`, `fill`, `text` (colours), `dash` (boolean), `pulse` (boolean, animated outline), `opacity` (0..1). The renderer emits exactly this; nothing else about a state is visual. |
| `rank` | Severity order, integer ≥ 0. Propagation only ever raises rank; the highest applies. Ties keep the declared state. |
| `available` | Whether an entity in this state counts toward a need's `min`. |
| `flows` | `keep`: connections touching the entity keep their load. `stop`: they carry no flow. |
| `cascade` | `none`: the state is about the entity alone. `children`: every descendant of a group in this state is set to it too (declared states only, so it cannot loop). |
| `description` | What the state means to you. Shown in the legend and the panel; never read by the engine. |

### 4.9 Kinds

`kinds` binds component and group kind names to representation, the same way.

```jsonc
"kinds": {
  "replace": false,
  "components": {
    "mainframe": { "glyph": "storage", "description": "z/OS LPAR" },          // reuse a preset glyph
    "sidecar":   { "glyph": "M2 2h12v12H2z", "box": { "dash": true } }        // or an SVG path in a 16×16 box
  },
  "groups": {
    "cell": { "frame": { "stroke": "#0891b2", "dash": true, "fill": "#ecfeff", "fillOpacity": 0.4 } }
  }
}
```

Preset glyphs: `service` (none), `database`, `queue`, `cache`, `gateway`, `client`, `storage`, `function`,
`external` (no glyph, dashed box). Preset frames: `tier`, `region`, `zone`, `cluster`, `boundary`. Kinds have no
mechanics; they are vocabulary with a picture.

## 5. Semantics

### 5.1 Rank and availability

Every entity has a declared state (default `states.default`) and an effective state computed by propagation. Effective state is
never lower-ranked than declared. An entity is **available** when its effective state's `available` is true.

Groups: a non-empty group behaves as if it had one need, `{ "any": [its direct members], "min": 1 }`, with the
document's default outcomes. So it takes `needs.unmet` when no member is available, `needs.reduced` when the need
is met with reduced redundancy, and otherwise keeps its declared state. An empty group's effective state is its
declared state. A group's state reaches its members only through `cascade: children`. One mechanic, no special
case.

### 5.2 Propagation

Given declared states (base model, then scenario steps, then runtime toggles), the engine first applies every
`cascade: children` state downward, then iterates to a fixed point. For each entity, for each need:

1. `available` = number of alternatives whose effective state is available.
2. If `available < min`: the need is **unmet**; the entity enters the need's `unmet` state.
3. Else if `available < total`, or the first available alternative is above the rank of `states.default`: the
   need is **met with reduced redundancy**; the entity enters the need's `reduced` state.
4. Else the need is **met** and contributes nothing.

The entity's effective state is the highest-ranked of its declared state and every need's contribution. Every
derived state carries a reason naming the need and the alternatives involved.

### 5.3 Flow

- A connection touching an entity whose effective state has `flows: stop` carries load 0.
- Within a need, the load of alternatives that are not available shifts to the first available alternative, added
  to its own. Alternatives with their own base load keep it (active-active).
- All other loads keep their declared or scenario value.

### 5.4 Scenarios

`set` assigns declared states; `load` sets declared loads; `restore` returns entities to their base-model state.
Propagation then runs.

### 5.5 Views

A view selects entities: all, or those inside `scope`, intersected with `only` (a group in `only` selects its
descendants too). Groups shown are those selected or containing a selected entity, up to the scope. Connections
shown are those with both ends selected; those with one end selected are drawn to a ghost (R4).

## 6. Invariants

Each is enforced where stated and proven by the named test. `S` structural (validator), `B` behavioural
(propagation), `R` rendering.

| # | Invariant | Enforced by | Test |
|---|---|---|---|
| S1 | Component and group ids are unique and share one id space. | validator | validate: duplicate-id, id-clash-component-group |
| S2 | Connection ids (when given), view ids and scenario ids are unique within their kind. | validator | validate: duplicate-connection-id, duplicate-view-id, scenario-duplicate-id |
| S3 | Every reference resolves: component→group, group→parent, connection ends→entities, view scope→group, view `only`→entities, scenario verbs→entities, scenario load→connections, need alternatives→entities. | validator | validate: unknown-* fixtures |
| S4 | Groups form a forest: no cycles, no self-parent. | validator | validate: group-cycle |
| S5 | No connection from an entity to itself, nor between an entity and one of its own ancestors or descendants (a component to the group that contains it says nothing). | validator | validate: self-connection, connection-to-ancestor |
| S6 | Two connections between the same ordered pair must both carry ids. | validator | validate: parallel-without-ids |
| S7 | A connection reference by `{from,to}` must be unambiguous; otherwise the reference must use `id`. | validator | validate: ambiguous-connection-ref |
| S8 | A scenario step changes at least one thing, and names each entity at most once across `set` and `restore`. | validator | validate: scenario-empty-step, scenario-conflicting-verbs |
| S9 | Every need alternative is an entity connected (either direction) to the needing component, and not an ancestor of it. | validator | validate: need-without-connection, need-on-ancestor |
| S10 | `any` has at least `min` alternatives, `min ≥ 1`, no duplicate alternatives, a component does not need itself. | validator | validate: need-shape fixtures |
| S11 | Every schema property has a description; unknown properties are errors. | schema test | schema: descriptions, unknown-property |
| S12 | Only `components` is required; a file of components alone is valid. | schema | validate: components-only |
| S13 | A group may be empty; it still renders and may be connected, needed and given a state. | schema, engines | validate: empty-group, layoutContract: empty group box |
| S14 | Every state name used anywhere (declared, `states.default`, need outcomes, scenario `set`) is defined after defaults and overrides are applied; every kind name likewise. With `replace: true`, `default` and the need outcomes are given explicitly. | validator | validate: unknown-state, unknown-kind, replace-without-default |
| S15 | Style objects are well-formed: colours are CSS colours, opacities 0..1, glyph paths parse as SVG path data. | validator | validate: bad-look, bad-glyph |
| B1 | Propagation is pure, deterministic and never mutates its input. | propagate | simulate: pure |
| B2 | Declared state is a floor: propagation only raises rank. | propagate | simulate: floor |
| B3 | Need evaluation follows 5.2 exactly, using each state's `available` and each need's `unmet`/`reduced`. | propagate | simulate: needs-* |
| B4 | Flow follows 5.3: zero on `flows: stop` entities, shift to the first available alternative, active-active preserved. | propagate | simulate: load-* |
| B5 | Propagation terminates on any graph including cycles (rank only rises). | propagate | simulate: cycle |
| B6 | Every derived state carries a reason naming the need and the alternatives involved. | propagate | simulate: reasons |
| B7 | Scenario steps are cumulative; step *k* equals the base model with steps 1..*k* applied. | applyScenario | simulate: cumulative |
| B8 | A state reaches descendants by containment only when its `cascade` is `children`; otherwise members are affected only through their own needs. | propagate | simulate: cascade-children, no-cascade |
| B9 | A non-empty group's effective state derives from its direct members per 5.1, floored by its declared state; an empty group's is its declared state. | propagate | simulate: group-up, empty-group |
| B10 | The engine references no state or kind by name: `replace: true` with different names and the same mechanics yields identical propagation. | propagate | simulate: renamed-states |
| R1 | The file never contains coordinates; layout is deterministic. | schema, engines | layoutContract: deterministic |
| R2 | Rendering is byte-deterministic for the same model. | renderer | render: deterministic, cli: deterministic |
| R3 | A connection that satisfies a need is visibly marked (darker line). | renderer | render: need-cue |
| R4 | A scoped view draws one-ended connections to a ghost; nothing is dropped silently. | renderer | view: ghosts |
| R5 | Animation is a pure function of the model and time (flow period, pulse period). | renderer, raster | raster: freeze, periodic |
| R8 | An entity is drawn by its state's look and its kind's glyph or frame, never by the names; a custom look or kind renders exactly its style object. | renderer | render: looks, custom-kinds |
| R9 | A legend lists every state actually used in a view with its look and description, so a reader learns the author's vocabulary from the drawing. | renderer | render: legend |
| R6 | Order in the file is a layout signal: siblings keep declaration order. | ELK adapter | elk: model order |
| R7 | A connection whose end is a group attaches to that group's frame; an empty group is drawn as a frame of minimum size. | engines, renderer | layoutContract: group endpoints |

## 7. Non-goals (v1)

- Performance, latency or capacity modelling. Load is relative and cosmetic.
- Health expressions (`db && (a || b)`). Needs are data: AND across needs, OR within `any`, `min` for quorum.
- Flowcharts, ER, class, state machines, Gantt. Ever.

## 8. Reserved

`interactions` (ordered messages over connections, for sequence and walkthrough views), view `type` values
`sequence` and `walkthrough`, `tags` on entities and `by-tag` view selection, `around` (neighbourhood) views.

## 9. Review log

Decisions from the principal-engineer review of 2026-09-05, so the reasoning is not lost:

- **Renamed** nodes/edges → components/connections in the file, messages and CLI. Internals keep graph terms.
- **Replaced** `dependsOn`, `fallback`, `fallbackFor` with `needs` on the component. The old shape hard-coded one
  redundancy pattern and required cross-references between connections; an agent test produced a wrong render
  because of it. `needs` with `any`/`min`/`soft` covers primary-standby, N-way, active-active and quorum as data.
- **Changed** the degradation rule to "any unhealthy alternative degrades" (reduced redundancy) rather than "only
  when running on a non-preferred alternative". Consistent for quorum sets and honest: a dead standby is a risk.
- **Removed** default connection ids (`from->to` strings) from the user-facing model. References use the pair.
- **Replaced** nested scenario state objects with verbs.
- **Added** `only` on views (large estates need subsets), `replicas`, `tech`, `description`, `bidirectional`, and
  `meta` as the extensibility escape hatch that keeps `additionalProperties: false` everywhere else.
- **Committed** to ghosts for one-ended connections in scoped views (R4); the previous "dropped" behaviour was
  the most-requested fix from agent tests.
- **Accepted, after first rejecting it,** connections and needs to groups, including empty groups. The first
  draft rejected them for layout reasons and because "needs the data tier" seemed ambiguous. The ambiguity is
  resolved by giving groups health of their own (5.1): declared state propagates down, member health derives up,
  an empty group is a black box with declared health. A first draft had a failed group take its members down by
  containment; dropped, because a member with alternatives outside the group may be merely degraded, and that
  must come from its needs. Only `off` cascades. Systems can be modelled as closed boxes first and opened later. Layout risk (compound-node endpoints in ELK) is an
  implementation task, not a modelling argument.
- **Rejected** health expressions (second syntax inside JSON) and inferring needs from `sync` connections
  (explicit over inferred).
- **Deferred** interactions and sequence views (need the runtime to play them), tags, neighbourhood views.
- **Separated meanings from mechanics** (2026-09-05, later). The tool had fixed states with fixed meanings and
  rules written in those terms ("down"). With enough users the words stop agreeing. Now the author declares state
  names bound to looks (`normal`, `warn`, `alert`, `muted`, `highlight`) and mechanics (`rank`, `available`,
  `flows`, `cascade`), needs name their own outcome states, and the default block reproduces the old behaviour so
  small files stay small. Scenario verbs became `set: { state: ids }` so new state names need no new verbs.
- **Made the vocabulary fully the author's** (2026-09-05, latest). Even the default outcome names leaked
  meaning into the engine, and looks and kinds were closed lists. Now `states` has `default`, `needs` outcomes,
  `replace`, and `define` with preset or custom looks; `kinds` does the same for components and groups with preset
  or custom glyphs and frames; groups derive their state through the ordinary need mechanic instead of a special
  rule; a legend teaches the reader the author's words. Defaults reproduce the old behaviour exactly.
- **Stance recorded**: a component is a deployed thing in one place. Multi-region deployments are several
  components, grouped by region. This keeps groups meaningful in deployment views and keeps health per instance.
