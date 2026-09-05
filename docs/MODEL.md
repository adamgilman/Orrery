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
- **Explicit over inferred.** Health semantics are declared by the author (`needs`). The engine never guesses
  that a connection implies a dependency, that a database is a fallback for another database, or what "primary"
  means from a label.
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
| **component** | A running thing in one place: a service, database, queue, client, external system. Two deployments of the same code in two regions are two components. | A codebase, a team, a class |
| **connection** | Something one component does to another: calls it, publishes to it, replicates to it, streams data to it. Directed from the initiator to the target. | A dependency (that is a need) |
| **group** | A container that means something: a tier, a region, a zone, a cluster, a trust boundary. Groups nest. | A layout hint |
| **need** | What a component cannot work without, declared on that component, satisfied by one or more alternative components. | A connection |
| **view** | One drawing of the model: a scope, a subset, a direction. | A second model |
| **scenario** | An ordered, cumulative sequence of what-ifs: fail, degrade, switch off, restore, shift load. | A test |
| **state** | Health of a component: `on`, `degraded`, `failed`, `off`. Declared in the model or a scenario, then propagated. | A metric |
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
| `kind` | `service` `database` `queue` `cache` `gateway` `client` `storage` `function` `external` | `service` | What it is; picks the glyph and box style. Carries no health semantics. |
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
| `from`, `to` | id | required | Component ids. Direction is who initiates. |
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
| `kind` | `tier` `region` `zone` `cluster` `boundary` | `tier` | Frame style: tier solid tinted, region dashed, zone dotted, cluster solid darker, boundary red dashed with no fill. |
| `parent` | id | | Enclosing group. |
| `meta` | object | | Free-form. |

### 4.5 View

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | id | required | Used by `render --view`. |
| `title` | string | document title | |
| `type` | `topology` | `topology` | `sequence` and `walkthrough` are reserved. |
| `direction` | `right` \| `down` | document direction | |
| `scope` | group id | | Drill in: the group is the outer frame; its descendants and the connections among them are shown. |
| `only` | array of component id | | Restrict to these components (and the groups that contain them). Combines with `scope` by intersection. |

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
| `fail`, `degrade`, `off`, `restore` | id or array of id | Set those components' declared state to `failed`, `degraded`, `off`, `on`. |
| `load` | array of `{ from, to, load }` or `{ id, load }` | Override a connection's load. Rarely needed: load shifts automatically when a need's alternative is unhealthy. |

A step must change at least one thing. The same component may not appear under two verbs in one step.

### 4.7 Need

A need is an entry in a component's `needs` array. Two forms:

- A component id: a hard need with one way to satisfy it. `"needs": ["db"]`.
- An object: `{ "any": [ids...], "min": 1, "soft": false }`. `any` lists alternatives in order of preference.
  `min` is how many must be healthy for the need to be met (quorum). `soft` means an unmet need degrades the
  component instead of failing it.

Every id in a need must be a component that has a connection with the needing component, in either direction
(invariant S9). Needs are about availability; they add no lines to the drawing, they change what the existing
lines mean, and they are drawn as a cue on those lines (R3).

## 5. Semantics

### 5.1 Health

States rank `on` < `degraded` < `failed`; `off` ranks with `failed` for propagation but is drawn differently.
A component is **down** when `failed` or `off`; **healthy** when `on`; `degraded` counts as healthy for quorum
but propagates degradation.

### 5.2 Propagation

Given declared states (base model plus scenario steps plus runtime toggles), the engine computes effective states
by iterating to a fixed point. For each component that is not down, for each need:

1. `healthy` = number of alternatives whose effective state is `on` or `degraded`.
2. If `healthy < min`: the need is **unmet**. Hard need → component `failed`; soft need → `degraded`.
3. Else if `healthy < total alternatives`, or the first healthy alternative is `degraded`: the need is **met with
   reduced redundancy** → component `degraded`.
4. Else the need is **met**.

The component's effective state is the worst over its needs, but never better than its declared state (declared
state is a floor). Every derived state carries a reason: which need, which alternatives are down, which one is in
use.

### 5.3 Load

- A connection touching a down component carries load 0.
- Within a need, load of alternatives that are down shifts to the first healthy alternative, added to its own.
  Alternatives with their own base load keep it (active-active).
- Loads not touched by the rules above keep their declared or scenario value.

### 5.4 Scenarios

Verbs set declared states; `load` sets declared loads. Propagation then runs. `restore` returns a component to
`on`, which is its declared base unless the base model says otherwise, in which case the base value applies.

### 5.5 Views

A view selects components: all, or those inside `scope`, intersected with `only`. Groups shown are those
containing a selected component, plus their ancestors up to the scope. Connections shown are those with both ends
selected; those with one end selected are drawn to a ghost (R4).

## 6. Invariants

Each is enforced where stated and proven by the named test. `S` structural (validator), `B` behavioural
(propagation), `R` rendering.

| # | Invariant | Enforced by | Test |
|---|---|---|---|
| S1 | Component and group ids are unique and share one id space. | validator | validate: duplicate-id, id-clash-component-group |
| S2 | Connection ids (when given), view ids and scenario ids are unique within their kind. | validator | validate: duplicate-connection-id, duplicate-view-id, scenario-duplicate-id |
| S3 | Every reference resolves: component→group, group→parent, connection ends→components, view scope→group, view `only`→components, scenario verbs→components, scenario load→connections, need alternatives→components. | validator | validate: unknown-* fixtures |
| S4 | Groups form a forest: no cycles, no self-parent. | validator | validate: group-cycle |
| S5 | No connection from a component to itself. | validator | validate: self-connection |
| S6 | Two connections between the same ordered pair must both carry ids. | validator | validate: parallel-without-ids |
| S7 | A connection reference by `{from,to}` must be unambiguous; otherwise the reference must use `id`. | validator | validate: ambiguous-connection-ref |
| S8 | A scenario step changes at least one thing, and names each component under at most one verb. | validator | validate: scenario-empty-step, scenario-conflicting-verbs |
| S9 | Every need alternative is a component connected (either direction) to the needing component. | validator | validate: need-without-connection |
| S10 | `any` has at least `min` alternatives, `min ≥ 1`, no duplicate alternatives, a component does not need itself. | validator | validate: need-shape fixtures |
| S11 | Every schema property has a description; unknown properties are errors. | schema test | schema: descriptions, unknown-property |
| S12 | Only `components` is required; a file of components alone is valid. | schema | validate: components-only |
| B1 | Propagation is pure, deterministic and never mutates its input. | propagate | simulate: pure |
| B2 | Declared state is a floor: propagation only worsens. | propagate | simulate: floor |
| B3 | Need evaluation follows 5.2 exactly: unmet, reduced redundancy, met. | propagate | simulate: needs-* |
| B4 | Load follows 5.3: zero on down components, shift to first healthy alternative, active-active preserved. | propagate | simulate: load-* |
| B5 | Propagation terminates on any graph including cycles (states move only upward in severity). | propagate | simulate: cycle |
| B6 | Every derived state carries a reason naming the need and the alternatives involved. | propagate | simulate: reasons |
| B7 | Scenario steps are cumulative; step *k* equals the base model with steps 1..*k* applied. | applyScenario | simulate: cumulative |
| R1 | The file never contains coordinates; layout is deterministic. | schema, engines | layoutContract: deterministic |
| R2 | Rendering is byte-deterministic for the same model. | renderer | render: deterministic, cli: deterministic |
| R3 | A connection that satisfies a need is visibly marked (darker line). | renderer | render: need-cue |
| R4 | A scoped view draws one-ended connections to a ghost; nothing is dropped silently. | renderer | view: ghosts |
| R5 | Animation is a pure function of the model and time (flow period, pulse period). | renderer, raster | raster: freeze, periodic |
| R6 | Order in the file is a layout signal: siblings keep declaration order. | ELK adapter | elk: model order |

## 7. Non-goals (v1)

- Performance, latency or capacity modelling. Load is relative and cosmetic.
- Connections to or from a group. Model the entry point as a component (gateway, load balancer).
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
- **Rejected** connections to groups (ambiguous semantics, awkward layout; use a gateway component), health
  expressions (second syntax inside JSON), inferring needs from `sync` connections (explicit over inferred).
- **Deferred** interactions and sequence views (need the runtime to play them), tags, neighbourhood views.
- **Stance recorded**: a component is a deployed thing in one place. Multi-region deployments are several
  components, grouped by region. This keeps groups meaningful in deployment views and keeps health per instance.
