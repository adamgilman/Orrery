# The Orrery model

Version 1, 2026-09-05. This document is the specification. The JSON Schema in `packages/core/schema/v1.json`
enforces the structure; the validator, the propagation engine and the renderer enforce the invariants in
section 6, each of which names the test that proves it. When this document and the code disagree, the code
has a bug.

## 1. Philosophy

- **A diagram is a model, not a picture.** Everything visible derives from the model. Nothing is placed by hand.
- **One model, many views.** The file describes what exists once. Views are drawings of it; scenarios are stories
  told over it. Both refer to the model by id and can introduce nothing.
- **Three layers.** The author owns the *vocabulary*: the names of states and kinds and what they mean. The
  renderer owns *representation*: looks, glyphs, frames, either presets or author-defined. The engine owns
  *mechanics*: rank, availability, flow, cascade, counting. Defaults exist for all three so a small file stays
  small, and every default can be extended or replaced. No rule in the engine or renderer names a state or a kind.
- **Users' words.** Components, connections, groups, needs. Never nodes, edges, vertices.
- **Progressive.** Components alone are a valid file and render. Every other field is an enrichment that adds a
  visible or behavioural change the author can see on the next render.
- **Explicit over inferred.** Dependencies are declared with `needs`. The engine never guesses that a connection
  implies a dependency, that a database is a fallback for another database, or what "primary" means from a label.
- **Connections are fluid.** Any entity can connect to any other entity: component to component, component to
  group, group to group, including empty groups. An empty group is a black box you have not opened yet.
- **Written by agents, read by humans.** Every property has a description in the schema. Unknown properties are
  errors. Errors carry a JSON pointer and a sentence.

## 2. A file, growing

```jsonc
// Step 1: components render as boxes.
{ "components": [ { "id": "web" }, { "id": "api" }, { "id": "db", "kind": "database" } ] }

// Step 2: connections render as arrows with flow.
{ "components": [ /* ... */ ],
  "connections": [ { "from": "web", "to": "api" }, { "from": "api", "to": "db", "load": 0.6 } ] }

// Step 3: a need makes the connection matter. `orrery render --set failed=db` shows the consequence.
{ "id": "api", "needs": ["db"] }

// Step 4: alternatives. `--set failed=db` now leaves the API degraded rather than failed, and load moves to the replica.
{ "id": "api", "needs": [ { "any": ["db", "replica"] } ] }

// Step 5: a scenario records a sequence of what-ifs.
{ "scenarios": [ { "id": "db-failover", "steps": [
    { "note": "Primary goes down", "set": { "failed": "db" } },
    { "note": "Recovered",         "restore": "db" } ] } ] }

// Step 6: views drill into groups and choose a direction.
{ "views": [ { "id": "overview" }, { "id": "data", "scope": "data", "direction": "down" } ] }

// Step 7: your own vocabulary. The words above (failed, degraded, database) are a default preset, not the tool's.
{ "states": { "default": "healthy", "replace": true, "needs": { "unmet": "outage", "reduced": "impaired" },
              "define": { "healthy": { "rank": 0 }, "impaired": { "look": "warn" },
                          "outage": { "look": "alert", "rank": 2, "available": false, "flows": "stop" } } } }
```

## 3. Vocabulary

| Word | Meaning | Not |
|---|---|---|
| **entity** | A component or a group. Anything that can be connected, needed, given a state, or shown. | |
| **component** | A running thing in one place: a service, database, queue, client, external system. Two deployments of the same code in two regions are two components. | A codebase, a team, a class |
| **connection** | Something one entity does to another: calls it, publishes to it, replicates to it, streams data to it. Directed from the initiator to the target. | A dependency (that is a need) |
| **group** | A container that means something: a tier, a region, a zone, a cluster, a trust boundary, or a whole system you have not opened yet. Groups nest and may be empty. | A layout hint |
| **need** | What a component cannot work without, declared on that component, satisfied by one or more alternative entities. | A connection |
| **state** | A named condition an entity is in, declared in the model or a scenario, then propagated. Names are the author's; each is bound to a look and to mechanics (4.8). | A metric, a fixed meaning |
| **look** | A visual treatment for a state: a preset (`normal`, `warn`, `alert`, `muted`, `highlight`) or an author-defined style. | A state |
| **kind** | A vocabulary word for what a component or group is, bound to a glyph or a frame style (4.9). | A behaviour |
| **view** | One drawing of the model: a scope, a subset, a direction. | A second model |
| **scenario** | An ordered, cumulative sequence of what-ifs: set states, restore them, shift load. | A test |
| **load** | Relative traffic on a connection, 0 to 1. Drives animation only. | Requests per second |

## 4. Entities

Entity ids match `^[A-Za-z0-9][A-Za-z0-9_.-]*$`; components and groups share one id space. State and kind names
match `^[A-Za-z][A-Za-z0-9_-]*$`. Ids are stable handles for references; labels are for people and default to
the id.

### 4.1 Document

| Field | Type | Default | Meaning |
|---|---|---|---|
| `$schema` | string | | Schema URL, for editor support. |
| `title` | string | | Title of the system. Shown on views that do not set their own. |
| `direction` | `right` \| `down` | `right` | Default flow direction for views. The only layout hint at this level. |
| `states` | object | the default set | See 4.8. |
| `kinds` | object | the default set | See 4.9. |
| `components` | array, at least one | required | See 4.2. |
| `connections` | array | `[]` | See 4.3. |
| `groups` | array | `[]` | See 4.4. |
| `views` | array | one view of everything | See 4.5. |
| `scenarios` | array | `[]` | See 4.6. |

### 4.2 Component

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | id | required | |
| `label` | string | id | Display name. |
| `kind` | kind name | `service` | What it is; picks the glyph and box style via `kinds`. No mechanics. |
| `group` | id | | The group it sits in. Omit for top level. |
| `state` | state name | `states.default` | Declared state in the base model. Propagation only ever moves an entity to a higher-ranked state. |
| `needs` | array of need | `[]` | See 4.7. |
| `replicas` | integer ≥ 1 | 1 | How many instances. Drawn as a stacked box with a count. No mechanics. |
| `tech` | string | | Technology, drawn as a sublabel: "PostgreSQL 16". |
| `description` | string | | Shown as a tooltip. |
| `meta` | object | | Free-form, ignored by rendering and mechanics: owner, URL, tags, cost centre. |

### 4.3 Connection

| Field | Type | Default | Meaning |
|---|---|---|---|
| `from`, `to` | id | required | Entity ids. Direction is who initiates. A connection to a group attaches to its frame (R7). |
| `id` | id | | Required when the same pair has more than one connection, so scenarios can tell them apart. |
| `kind` | `sync` `async` `replication` `dataflow` | `sync` | How it is drawn. No mechanics. |
| `label` | string | | Short text on the line: protocol, purpose. |
| `load` | 0..1 | 0.5 | Relative traffic; speed and weight of the flow. 0 hides the flow. |
| `bidirectional` | boolean | false | Arrowheads at both ends. Flow still animates from `from` to `to`. |
| `meta` | object | | Free-form. |

A scenario refers to a connection by `{ "from", "to" }`, or by `{ "id" }` when that pair is ambiguous (S7).

### 4.4 Group

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | id | required | |
| `label` | string | id | Frame title. |
| `kind` | kind name | `tier` | Frame style via `kinds`. No mechanics. |
| `parent` | id | | Enclosing group. |
| `state` | state name | `states.default` | Declared state of the group as an entity: what connections and needs pointing at it see. Reaches members only if the state's `cascade` says so (5.1). For an empty group this is its only state. |
| `description` | string | | Shown as a tooltip. |
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
| `scope` | group id | | Drill in: the group becomes the outer frame and only its descendants are shown. |
| `only` | array of entity id | | Restrict to these entities; a group id means the group and everything in it. Groups containing a selected entity are shown. Combines with `scope` by intersection. |

Connections with exactly one end inside a view are drawn to a ghost of the outside entity at the view's edge
(R4). Nothing is dropped silently.

### 4.6 Scenario

| Field | Type | Meaning |
|---|---|---|
| `id` | id | |
| `label` | string | Defaults to id. |
| `steps` | array of step, at least one | Cumulative: the state at step *k* is the base model with steps 1..*k* applied in order. Steps are numbered from 1. |

Step:

| Field | Type | Meaning |
|---|---|---|
| `note` | string | What happens, shown during step-through. |
| `set` | object: state name → entity id or array | Set those entities' declared state. On a group, the state applies to the group as an entity and reaches its members only if it cascades. |
| `restore` | entity id or array | Return those entities to their base-model declared state. |
| `load` | array of `{ from, to, load }` or `{ id, load }` | Override a connection's load. Rarely needed: load shifts automatically when a need's alternative is unavailable. |

A step must change at least one thing and may name an entity only once across `set` and `restore` (S8).

### 4.7 Need

A need is an entry in a component's `needs` array. Two forms:

- An entity id: a hard need with one way to satisfy it. `"needs": ["db"]` or `"needs": ["payments-platform"]`.
- An object: `{ "any": [ids...], "min": 1, "unmet": "failed", "reduced": "degraded" }`. `any` lists
  alternatives in order of preference. `min` is how many must be available for the need to be met (quorum).
  `unmet` names the state the component enters when fewer than `min` are available; `reduced` the state when the
  need is met with reduced redundancy (5.2). Both default from `states.needs`. A nice-to-have call is
  `"unmet": "degraded"` (or whatever your low-rank state is called).

Every alternative must be an entity that is connected to the needing component, either directly in either
direction or through a connection to a group containing it, and must not be a group that contains the needing
component (S9). Needs add no lines; they make existing lines matter, and those lines are drawn darker (R3). A
need on a group is the progressive form: need the black box now, refine to the component inside it once the box
is opened.

### 4.8 States

`states` binds the author's state names to representation and mechanics. The engine and renderer read only the
right-hand side; the names and their meanings are the author's.

```jsonc
"states": {
  "default": "on",                                            // state of anything not declared otherwise
  "needs":   { "unmet": "failed", "reduced": "degraded" },    // outcomes needs use unless they say otherwise
  "replace": false,                                           // true: only the names below exist
  "define": {
    "on":       { "look": "normal", "rank": 0, "available": true },
    "degraded": { "look": "warn",   "rank": 1, "available": true },
    "failed":   { "look": "alert",  "rank": 2, "available": false, "flows": "stop" },
    "off":      { "look": "muted",  "rank": 2, "available": false, "flows": "stop", "cascade": "children" },
    "brownout": { "look": { "stroke": "#7c3aed", "fill": "#f5f3ff", "pulse": true }, "rank": 1,
                  "description": "Serving with feature flags off" }
  }
}
```

The block above, minus `brownout`, is the default. Omitting `states` gives exactly it. Defining a name that
exists overrides only the fields you give; defining a new name extends the set; `replace: true` discards the
defaults, in which case `default`, `needs.unmet` and `needs.reduced` must name states from `define` (S14).

| Field | Default | Meaning |
|---|---|---|
| `look` | `normal` | A preset name (`normal`, `warn`, `alert`, `muted`, `highlight`) or a style object with `stroke`, `fill`, `text` (colours), `dash`, `pulse` (animated outline), `opacity` (0..1). The renderer emits exactly this; nothing else about a state is visual. |
| `rank` | 1 | Severity order, integer ≥ 0. Set 0 on your baseline state. Propagation only ever raises rank; the highest applies. |
| `available` | true | Whether an entity in this state counts toward a need's `min`. |
| `flows` | `keep` | `stop`: connections touching an entity in this state carry no flow. |
| `cascade` | `none` | `children`: every descendant of a group in this state is set to it too. |
| `description` | | What the state means to you. Shown in the legend; never read by the engine. |

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
    "cell":  { "frame": { "stroke": "#0891b2", "dash": true, "fill": "#ecfeff", "fillOpacity": 0.4 } },
    "vpc":   { "frame": "region" }                                            // or a preset frame
  }
}
```

Preset glyphs: `database`, `queue`, `cache`, `gateway`, `client`, `storage`, `function`; `service` has none and
`external` is a dashed box. Preset frames: `tier`, `region` (dashed), `zone` (dotted), `cluster` (darker),
`boundary` (red dashed, no fill). A frame style object takes `stroke`, `fill`, `fillOpacity`, `dash`, `dotted`.
A component box style takes `dash`, `fill`, `stroke`. Kinds have no mechanics; they are vocabulary with a picture.

### 4.10 Warnings

The validator reports, without failing, a source that connects both to a group and to something inside it: both
lines will be drawn, which is usually a mistake. Warnings carry a pointer like errors.

## 5. Semantics

### 5.1 Rank, availability, groups

Every entity has a declared state (default `states.default`) and an effective state computed by propagation.
Effective state is never lower-ranked than declared. An entity is **available** when its effective state's
`available` is true.

A group's declared state describes the group as an entity: it is what connections and needs pointing at the
group see. It does not force member states; failure reaches members only through their own needs. The one
mechanic that crosses containment is `cascade: children`, which sets every descendant's declared state to the
group's (a higher-ranked declared state on a descendant is kept).

A non-empty group is also judged by its members. It behaves as if it had one need over its direct members,
`{ "any": [members], "min": 1 }` with the document's default outcomes, evaluated without preference order: the
members are a set. It takes `needs.unmet` when no member is available, `needs.reduced` when any member is
unavailable or above the default rank, and otherwise keeps its declared state. An empty group's effective state
is its declared state.

### 5.2 Propagation

Given declared states (base model, then scenario steps, then runtime changes), the engine first applies every
`cascade: children` state downward (declared states only, so it cannot loop), then iterates to a fixed point.
For each entity, for each need:

1. `available` = number of alternatives whose effective state is available.
2. If `available < min`: the need is **unmet**; the entity enters the need's `unmet` state.
3. Else if `available < total`, or (for component needs) the first available alternative is above the rank of
   `states.default`: the need is **met with reduced redundancy**; the entity enters the need's `reduced` state.
4. Else the need is **met** and contributes nothing.

The entity's effective state is the highest-ranked of its declared state and every need's contribution; on a
tie the declared state wins, and among needs the first in declaration order wins. Every derived state carries a
reason naming the need and the alternatives involved.

### 5.3 Flow

- A connection touching an entity whose effective state has `flows: stop` carries load 0.
- Within a need, the load of connections from the component to unavailable alternatives shifts onto its
  connection to the first available alternative, added to that connection's own load and capped at 1.
  Alternatives with their own base load keep it (active-active).
- All other loads keep their declared or scenario value.

### 5.4 Scenarios

`set` assigns declared states; `load` sets declared loads; `restore` returns entities to their base-model state.
Steps are cumulative. Propagation then runs on the result.

### 5.5 Views

A view selects entities: everything, or the scope group and its descendants, intersected with `only` (a group in
`only` selects its descendants too). Groups shown are the selected ones plus those containing a selected
entity, up to the scope. Connections shown are those with both ends selected; those with one end selected are
kept and the outside end becomes a ghost at the top level (R4).

## 6. Invariants

`S` structural (validator), `B` behavioural (propagation), `R` rendering. The test column names the file and the
`describe` or fixture that proves it; every fixture under `fixtures/invalid` is paired with its expected pointers.

| # | Invariant | Test |
|---|---|---|
| S1 | Component and group ids are unique and share one id space. | validate.test: invalid fixtures `duplicate-id`, `id-clash-component-group` |
| S2 | Connection ids (when given), view ids and scenario ids are unique within their kind. | invalid fixtures `duplicate-connection-id`, `duplicate-view-id`, `scenario-duplicate-id` |
| S3 | Every reference resolves: component→group, group→parent, connection ends, view scope and `only`, scenario `set`/`restore`/`load`, need alternatives. | invalid fixtures `unknown-*`, `scenario-unknown-*` |
| S4 | Groups form a forest: no cycles, no self-parent. | invalid fixture `group-cycle` |
| S5 | No connection from an entity to itself, nor between an entity and one of its own ancestors or descendants. | invalid fixtures `self-connection`, `connection-to-ancestor` |
| S6 | Two connections between the same ordered pair must both carry ids. | invalid fixture `parallel-without-ids` |
| S7 | A connection reference by `{from,to}` must be unambiguous; otherwise the reference must use `id`. | invalid fixture `ambiguous-connection-ref`; valid fixture `parallel` |
| S8 | A scenario step changes at least one thing and names each entity at most once across `set` and `restore`. | invalid fixtures `scenario-empty-step`, `scenario-conflicting-verbs` |
| S9 | Every need alternative is an entity connected to the needing component (directly or via a containing group) and not an ancestor of it. | invalid fixtures `need-without-connection`, `need-on-ancestor`; valid fixture `own-vocabulary` |
| S10 | `min ≤ |any|`, `min ≥ 1`, no duplicate alternatives, a component does not need itself. | invalid fixture `need-shape` |
| S11 | Every schema property has a description; unknown properties are errors. | schema.test; invalid fixture `unknown-property` |
| S12 | Only `components` is required; a file of components alone is valid. | validate.test "normalisation (S12, defaults)"; valid fixtures `minimal`, `sketch` |
| S13 | A group may be empty; it still renders and may be connected, needed and given a state. | valid fixture `group-endpoints`; layoutContract "(group endpoints)" |
| S14 | Every state and kind name used anywhere is defined after defaults and overrides; with `replace: true`, `default` and need outcomes are given explicitly. | validate.test "vocabulary (S14)"; invalid fixtures `unknown-state`, `unknown-kind`, `unknown-group-kind`, `replace-without-default`, `scenario-unknown-state` |
| S15 | A glyph is a preset name or SVG path data; a look is a preset name or a style object; a frame is a preset name or a style object. | invalid fixtures `bad-glyph`, `bad-look` |
| B1 | Propagation is pure, deterministic and never mutates its input. | simulate.test "(B1, B5)" |
| B2 | Declared state is a floor: propagation only raises rank. | simulate.test "(B2, B3, B6)" |
| B3 | Need evaluation follows 5.2 exactly, using each state's `available` and each need's `unmet`/`reduced`. | simulate.test "(B2, B3, B6)", "quorum on the component" |
| B4 | Flow follows 5.3. | simulate.test "an alternative down: reduced redundancy, load shifts" |
| B5 | Propagation terminates on any graph including cycles. | simulate.test "(B1, B5)"; valid fixture `cycle` |
| B6 | Every derived state carries a reason naming the need and the alternatives involved. | simulate.test "(B2, B3, B6)" |
| B7 | Scenario steps are cumulative; step *k* equals the base model with steps 1..*k* applied. | simulate.test "applyScenario (B7)" |
| B8 | A state reaches descendants by containment only when its `cascade` is `children`; otherwise members are affected only through their own needs. | simulate.test "groups and cascade (B8, B9)" |
| B9 | A non-empty group's effective state derives from its direct members per 5.1, independent of member order, floored by its declared state; an empty group's is its declared state. | simulate.test "(B8, B9)", "independent of member order (B9)" |
| B10 | The engine references no state or kind by name: `replace: true` with different names and the same mechanics yields identical propagation. | simulate.test "names do not matter (B10)" |
| R1 | The file never contains coordinates; layout is deterministic. | schema (no coordinate fields); layoutContract "is deterministic" |
| R2 | Rendering is byte-deterministic for the same model. | render.test "escapes text, is deterministic"; cli.test "byte-for-byte deterministic" |
| R3 | A connection that satisfies a need is visibly marked. | render.test "marks connections that satisfy a need" |
| R4 | A scoped view draws one-ended connections to a ghost; nothing is dropped silently. | view.test "ghosts for one-ended ones"; render.test "draws ghosts" |
| R5 | Animation is a pure function of the model and time. | raster frames.test, pulse.test |
| R6 | Order in the file is a layout signal: siblings keep declaration order. | elk.test "model order" |
| R7 | A connection whose end is a group attaches to that group's frame; an empty group is drawn as a frame of minimum size. | layoutContract "(group endpoints)" |
| R8 | An entity is drawn by its state's look and its kind's glyph or frame, never by the names; a custom look or kind renders exactly its style object. | render.test "looks and kinds (R8)" |
| R9 | A legend lists every non-default state used in a view with its look and description. | render.test "legend (R9)" |

## 7. Non-goals (v1)

- Performance, latency or capacity modelling. Load is relative and cosmetic.
- Health expressions (`db && (a || b)`). Needs are data: AND across needs, OR within `any`, `min` for quorum.
- Flowcharts, ER, class, state machines, Gantt.

## 8. Reserved

`interactions` (ordered messages over connections, for sequence and walkthrough views), view `type` values
`sequence` and `walkthrough`, `tags` on entities and by-tag view selection, `around` (neighbourhood) views,
vocabulary packs (`states.use`, `kinds.use`).

## 9. Decisions

Recorded so the reasoning is not lost. Dates are 2026-09-05.

- **Component = one deployment in one place.** Multi-region systems are several components grouped by region.
  Keeps health per instance and makes deployment views work with plain groups.
- **Dependencies live on the component as `needs`,** not on connections. The earlier edge fields (`dependsOn`,
  `fallback`, `fallbackFor`) hard-coded one redundancy shape and produced a wrong render in an agent test.
- **Connections and needs to groups, including empty ones,** after first rejecting them for layout reasons.
  Groups have health of their own (5.1); layout risk is an adapter problem.
- **Group state does not cascade by containment; `cascade: children` is the only such mechanic.** A member with
  alternatives outside a failed group may be merely reduced, and that must come from its needs.
- **Group members are a set.** The fourth agent walk found the derived state depended on declaration order.
- **Vocabulary is the author's.** Fixed system states (and the word "down") were removed from the engine. Defaults
  reproduce the old behaviour exactly.
- **Rejected:** health expressions (a second syntax inside JSON); inferring needs from `sync` connections
  (explicit over inferred); default connection ids like `a->b` in the user-facing model.
