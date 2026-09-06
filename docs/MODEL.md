# The Orrery model

Version 1, 2026-09-05. This document is the specification. The JSON Schema in `packages/core/schema/v1.json`
enforces the structure; the validator and the renderer enforce the invariants in section 6, each of which names
the test that proves it. When this document and the code disagree, the code
has a bug.

## 1. Philosophy

- **A diagram is a model, not a picture.** Everything visible derives from the model. Nothing is placed by hand.
- **One model, many views.** The file describes what exists once. Views are drawings of it; scenarios are stories
  told over it. Both refer to the model by id and can introduce nothing.
- **Two layers.** The author owns the *vocabulary*: the names of states and kinds and what they mean. The renderer
  owns *representation*: looks, glyphs, frames, lines, either presets or author-defined. Defaults exist for both so
  a small file stays small, and every default can be extended or replaced. No rule in the renderer names a state
  or a kind.
- **Users' words.** Components, connections, groups, states. Never nodes, edges, vertices.
- **Progressive.** Components alone are a valid file and render. Every other field is an enrichment that adds a
  visible or behavioural change the author can see on the next render.
- **Declared, never inferred.** Every state in every picture is one the author wrote down: in the base model, in a
  scenario step, or in a what-if. The tool does not work out what a failure does to the rest of the system; the
  author says so, with a reason if they want one. It is the author's diagram.
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

// Step 3: a what-if. `orrery render --set failed=db` draws the database failed and its flows stopped.

// Step 4: a scenario records what happens, in the author's words, with reasons.
{ "scenarios": [ { "id": "db-fails", "steps": [
    { "note": "Primary goes down", "set": { "failed": "db", "degraded": { "api": "reads from the replica" } },
      "load": [ { "from": "api", "to": "db", "load": 0 }, { "from": "api", "to": "replica", "load": 0.6 } ] },
    { "note": "Recovered", "restore": ["db", "api"] } ] } ] }

// Step 5: views drill into groups and choose a direction.
{ "views": [ { "id": "overview" }, { "id": "data", "scope": "data", "direction": "down" } ] }

// Step 6: your own vocabulary. The words above (failed, degraded, database) are a default preset, not the tool's.
{ "states": { "default": "healthy", "replace": true,
              "define": { "healthy": {}, "impaired": { "look": "warn" },
                          "outage": { "look": "alert", "flows": "stop" } } },
  "kinds": { "connections": { "gossip": { "line": { "dash": "2 3", "stroke": "#0891b2" } } } } }
```

## 3. Vocabulary

| Word | Meaning | Not |
|---|---|---|
| **entity** | A component or a group. Anything that can be connected, given a state, or shown. | |
| **component** | A running thing in one place: a service, database, queue, client, external system. Two deployments of the same code in two regions are two components. | A codebase, a team, a class |
| **connection** | Something one entity does to another: calls it, publishes to it, replicates to it, streams data to it. Directed from the initiator to the target. Drawn by its kind's line. | A dependency |
| **group** | A container that means something: a tier, a region, a zone, a cluster, a trust boundary, or a whole system you have not opened yet. Groups nest and may be empty. | A layout hint |
| **state** | A named condition an entity is in, declared in the model, a scenario step or a what-if. Names are the author's; each is bound to a look and a flow rule (4.7). | A metric, a fixed meaning, something computed |
| **reason** | The author's one-line explanation of why an entity is in a state at a step. Shown as a tooltip. | |
| **look** | A visual treatment for a state: a preset (`normal`, `warn`, `alert`, `muted`, `highlight`) or an author-defined style. | A state |
| **kind** | A vocabulary word for what a component, group or connection is, bound to a glyph, a frame or a line style (4.8). | A behaviour |
| **view** | One drawing of the model: a scope, a subset, a direction. | A second model |
| **scenario** | An ordered, cumulative sequence of what-ifs: set states with reasons, restore them, set loads. | A test, a simulation |
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
| `states` | object | the default set | See 4.7. |
| `kinds` | object | the default set | See 4.8. |
| `components` | array, at least one | required | See 4.2. |
| `connections` | array | `[]` | See 4.3. |
| `groups` | array | `[]` | See 4.4. |
| `views` | array | one view of everything | See 4.5. |
| `scenarios` | array | `[]` | See 4.6. |
| `exports` | array of export | `[]` | The files to write from this model, one picture or animation each: `orrery export` renders them all (4.9). |
| `tour` | `{ seconds, scenes }` or `{ seconds, views }` | | A story told on a timer. Each scene is a view at a moment: `{ view, open?, zoom?, scenario?, step?, set?, note?, seconds? }`. `open` lists the closed groups drawn open and `zoom` names what the camera closes on; they are separate actions, so a scene can open two groups and stay zoomed out, or zoom in on one. `views` is shorthand for one scene per view. When every scene shares one view, the file is one drawing that moves between layouts in CSS, so it plays inside an image tag; the runtime does the same until the reader interacts (R12). |

### 4.2 Component

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | id | required | |
| `label` | string | id | Display name. |
| `kind` | kind name | `service` | What it is; picks the glyph and box style via `kinds`. |
| `group` | id | | The group it sits in. Omit for top level. |
| `state` | state name | `states.default` | State in the base model. Scenario steps and what-ifs change it. |
| `replicas` | integer ≥ 1 | 1 | How many instances. Drawn as a stacked box with a count. |
| `tech` | string | | Technology, drawn as a sublabel: "PostgreSQL 16". |
| `description` | string | | Shown as a tooltip. |
| `meta` | object | | Free-form, ignored by rendering: owner, URL, tags, cost centre. |

### 4.3 Connection

| Field | Type | Default | Meaning |
|---|---|---|---|
| `from`, `to` | id | required | Entity ids. Direction is who initiates. A connection to a group attaches to its frame (R7). |
| `id` | id | | Required when the same pair has more than one connection, so scenarios can tell them apart. |
| `kind` | kind name | `sync` | How it is drawn: the line style bound to that name in `kinds.connections` (4.8). Defaults: `sync` solid, `async` dashed, `replication` dotted, `dataflow` heavy. |
| `label` | string | | Short text on the line: protocol, purpose. |
| `load` | 0..1 | 0.5 | Relative traffic; speed and weight of the flow. 0 hides the flow. Scenario steps change it. |
| `bidirectional` | boolean | false | Arrowheads at both ends. Flow still animates from `from` to `to`. |
| `meta` | object | | Free-form. |

A scenario refers to a connection by `{ "from", "to" }`, or by `{ "id" }` when that pair is ambiguous (S7).

### 4.4 Group

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | id | required | |
| `label` | string | id | Frame title. |
| `kind` | kind name | `tier` | Frame style via `kinds`. |
| `parent` | id | | Enclosing group. |
| `state` | state name | `states.default` | State of the group as an entity: how its frame is drawn. It says nothing about the members; set theirs too if they change. |
| `description` | string | | Shown as a tooltip. |
| `meta` | object | | Free-form. |

An empty group is valid and is drawn as a frame of minimum size: a black box. Add members later and every
connection pointing at it keeps working.

### 4.5 View

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | id | required | Used by `render --view`. |
| `title` | string | document title | |
| `type` | `topology` | `topology` | `sequence` and `walkthrough` are reserved. |
| `direction` | `right` \| `down` | document direction | |
| `scope` | group id | | Drill in: the group becomes the outer frame and only its descendants are shown. |
| `only` | array of entity id | | Restrict to these entities; a group id means the group and everything in it. Groups containing a selected entity are shown. Combines with `scope` by intersection. |
| `collapse` | array of group id | | Groups drawn closed in this view: a closed group is one box the size of a component, its name centred with an expand mark in the corner; what is inside is not drawn, and connections to it re-attach to the box. Opening it, from a scene's or export's `open`, a click, or a page's call, lays the view out again with the group as a frame and its members inside, and the picture moves from one layout to the other. Closed groups nest to any depth; opening an inner one means opening the ones above it too (R11). |
| `play` | `{ scenario, seconds }` | | Play that scenario on a timer in this view: the base model, then each step for `seconds` (default 3), looping. In the file this is pure CSS over pre-rendered step layers, so it plays inside an image tag; the interactive runtime plays the same steps until the reader interacts (R10). |

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
| `set` | object: state name → entity id, array of ids, or object of id → reason | Put those entities in that state. `"set": { "failed": "db", "degraded": { "api": "reads from the replica" } }`. A reason is the author's explanation, shown as a tooltip. On a group, the state applies to the group's frame only. |
| `restore` | entity id or array | Return those entities to their base-model state and drop their reasons. |
| `load` | array of `{ from, to, load }` or `{ id, load }` | Set a connection's load. This is how traffic moves in a story: off one path, onto another. |

A step must change at least one thing and may name an entity only once across `set` and `restore` (S8).

### 4.7 States

`states` binds the author's state names to how they are drawn. The renderer reads only the right-hand side; the
names and their meanings are the author's.

```jsonc
"states": {
  "default": "on",                                            // state of anything not declared otherwise
  "replace": false,                                           // true: only the names below exist
  "define": {
    "on":       { "look": "normal" },
    "degraded": { "look": "warn" },
    "failed":   { "look": "alert", "flows": "stop" },
    "off":      { "look": "muted", "flows": "stop" },
    "brownout": { "look": { "stroke": "#7c3aed", "fill": "#f5f3ff", "pulse": true },
                  "description": "Serving with feature flags off" }
  }
}
```

The block above, minus `brownout`, is the default. Omitting `states` gives exactly it. Defining a name that
exists overrides only the fields you give; defining a new name extends the set; `replace: true` discards the
defaults, in which case `default` must name a state from `define` (S14).

| Field | Default | Meaning |
|---|---|---|
| `look` | `normal` | A preset name (`normal`, `warn`, `alert`, `muted`, `highlight`) or a style object with `stroke`, `fill`, `text` (colours), `dash`, `pulse` (animated outline), `opacity` (0..1). The renderer emits exactly this. |
| `flows` | `keep` | `stop`: connections touching an entity in this state are drawn with no flow, whatever their load. A drawing rule, so a failed box is not shown receiving traffic. |
| `description` | | What the state means to you. Shown in the legend. |

### 4.8 Kinds

`kinds` binds component, group and connection kind names to representation, the same way.

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
  },
  "connections": {
    "gossip":  { "line": { "dash": "2 3", "stroke": "#0891b2" }, "description": "Membership gossip" },
    "depends": { "line": "heavy" }                                            // or a preset line
  }
}
```

Preset glyphs: `database`, `queue`, `cache`, `gateway`, `client`, `storage`, `function`; `service` has none and
`external` is a dashed box. Preset frames: `tier`, `region` (dashed), `zone` (dotted), `cluster` (darker),
`boundary` (red dashed, no fill). Preset lines: `solid`, `dashed`, `dotted`, `heavy`; the default connection
kinds `sync`, `async`, `replication` and `dataflow` bind to them in that order. A frame style object takes
`stroke`, `fill`, `fillOpacity`, `dash`, `dotted`. A component box style takes `dash`, `fill`, `stroke`. A line
style object takes `stroke` (colour), `width` (px), `dash` (an SVG dash pattern such as `"6 5"`) and `flow` (the
colour of the animated traffic). Kinds are vocabulary with a picture.

### 4.9 Exports

The pictures and animations this model produces, declared next to the views and scenarios they draw from, so the
images in the documentation are regenerated by the same build as the system they describe. `orrery export <file>
--out <dir>` writes every entry to `<dir>/<id>.svg`: enclosed files, CSS animation only, no script, so each plays
inside an image tag anywhere.

| Field | Meaning |
|---|---|
| `id` | The file name without extension. Unique within `exports`. |
| `view` | View id. Default: the first view. |
| `open` | Closed groups of the view drawn open, each with its closed ancestors listed too: a still of the inside. |
| `zoom` | An entity not inside a closed group; the picture is cropped to it with a little air around it. |
| `scenario`, `step` | A scenario moment, as `render --scenario --step`. |
| `set` | A what-if, as a scenario step's `set`. |
| `play` | Scenario id to play on a loop, as a view's `play`; `seconds` per step (default 3). |
| `tour` | `true`: the model's tour, as one drawing that moves. Exclusive with every field but `id`. |

`play` and `scenario` are exclusive (S16).

### 4.10 Warnings

The validator reports, without failing, a source that connects both to a group and to something inside it: both
lines will be drawn, which is usually a mistake. Warnings carry a pointer like errors.

## 5. Semantics

### 5.1 States are declared

Every entity has exactly the state the author gave it: in the base model (`state`, default `states.default`),
changed by scenario steps in order, then by a what-if (`--set`, a tour scene's `set`, or a click in the
interactive file). Nothing computes a state from another state. A group's state is the group's own; members keep
theirs until a step sets them. A reason set alongside a state travels with it until the entity is set again or
restored.

### 5.2 Flow

A connection is drawn with the load the author gave it: the base `load`, changed by scenario steps. One drawing
rule applies on top: a connection touching an entity whose state has `flows: stop` is drawn with no flow. Loads
never move on their own.

### 5.3 Scenarios

Steps are cumulative: the situation at step *k* is the base model with steps 1..*k* applied in order. `set`
assigns states and reasons; `load` assigns loads; `restore` returns entities to their base-model state and drops
their reasons. A what-if is applied after the scenario position.

### 5.4 Views

A view selects entities: everything, or the scope group and its descendants, intersected with `only` (a group in
`only` selects its descendants too). Groups shown are the selected ones plus those containing a selected
entity, up to the scope. Connections shown are those with both ends selected; those with one end selected are
kept and the outside end becomes a ghost at the top level (R4).

## 6. Invariants

`S` structural (validator), `B` behavioural (declaration), `R` rendering. The test column names the file and the
`describe` or fixture that proves it; every fixture under `fixtures/invalid` is paired with its expected pointers.

| # | Invariant | Test |
|---|---|---|
| S1 | Component and group ids are unique and share one id space. | validate.test: invalid fixtures `duplicate-id`, `id-clash-component-group` |
| S2 | Connection ids (when given), view ids and scenario ids are unique within their kind. | invalid fixtures `duplicate-connection-id`, `duplicate-view-id`, `scenario-duplicate-id` |
| S3 | Every reference resolves: component→group, group→parent, connection ends, view scope, `only` and `collapse` (groups inside the scope), scenario `set`/`restore`/`load`. | invalid fixtures `unknown-*`, `scenario-unknown-*`, `collapse-*` |
| S4 | Groups form a forest: no cycles, no self-parent. | invalid fixture `group-cycle` |
| S5 | No connection from an entity to itself, nor between an entity and one of its own ancestors or descendants. | invalid fixtures `self-connection`, `connection-to-ancestor` |
| S6 | Two connections between the same ordered pair must both carry ids. | invalid fixture `parallel-without-ids` |
| S7 | A connection reference by `{from,to}` must be unambiguous; otherwise the reference must use `id`. | invalid fixture `ambiguous-connection-ref`; valid fixture `parallel` |
| S8 | A scenario step changes at least one thing and names each entity at most once across `set` and `restore`. | invalid fixtures `scenario-empty-step`, `scenario-conflicting-verbs` |
| S9 | A scenario step's `set` names each entity once, as an id, in a list, or as an id with a reason. | invalid fixture `scenario-conflicting-verbs`; validate.test "normalisation" |
| S11 | Every schema property has a description; unknown properties are errors. | schema.test; invalid fixture `unknown-property` |
| S12 | Only `components` is required; a file of components alone is valid. | validate.test "normalisation (S12, defaults)"; valid fixtures `minimal`, `sketch` |
| S13 | A group may be empty; it still renders and may be connected and given a state. | valid fixture `group-endpoints`; layoutContract "(group endpoints)" |
| S14 | Every state and kind name used anywhere (components, groups, connections) is defined after defaults and overrides; with `replace: true`, `default` is given explicitly. | validate.test "vocabulary (S14)"; invalid fixtures `unknown-state`, `unknown-kind`, `unknown-group-kind`, `unknown-connection-kind`, `replace-without-default`, `scenario-unknown-state` |
| S15 | Colours are CSS colours; a glyph is a preset name or SVG path data; looks, frames and lines are preset names or style objects. | invalid fixtures `bad-colour`, `bad-glyph`, `bad-look`, `bad-line` |
| S16 | Export ids are unique; `view`, `scenario`, `step`, `set` and `play` resolve as elsewhere; `play` and `scenario` are exclusive; `tour` needs a tour and stands alone. | validate.test "exports (S16)"; invalid fixtures `export-duplicate-id`, `export-unknown-view`, `export-play-and-scenario`, `export-tour-without-tour` |
| S17 | Opening and zooming are declared apart and checked the same way in a scene and an export: every `open` id is a group in the view's `collapse`, and a group inside another closed group needs that one in `open` too, so what is open is exactly what is written; `zoom` is an entity not inside a closed group. `open` is kept in declaration order. | invalid fixtures `open-and-zoom`, `tour-bad-zoom`; validate.test "exports (S16)" |
| B1 | Declaring is pure, deterministic and never mutates its input. | declare.test "pure (B1)" |
| B2 | Scenario steps are cumulative; step *k* equals the base model with steps 1..*k* applied; `restore` returns to the base model and drops reasons; a what-if applies last. | declare.test "scenario steps (B2)" |
| B3 | No state is ever computed: with no step naming an entity, its state is its base-model state whatever happens around it. | declare.test "nothing is inferred (B3)" |
| B4 | A connection touching an entity whose state stops flows is drawn with load 0; every other load is exactly as declared. | declare.test "flow (B4)" |
| R1 | The file never contains coordinates; layout is deterministic. | schema (no coordinate fields); layoutContract "is deterministic" |
| R2 | Rendering is byte-deterministic for the same model. | render.test "escapes text, is deterministic"; cli.test "byte-for-byte deterministic" |
| R3 | A connection is drawn by its kind's line style, preset or author-defined, never by its name. | render.test "draws connections by their kind's line" |
| R4 | A scoped view draws one-ended connections to a ghost; nothing is dropped silently. | view.test "ghosts for one-ended ones"; render.test "draws ghosts" |
| R5 | Animation is a pure function of the model and time. | raster frames.test, pulse.test |
| R6 | Order in the file is a layout signal: siblings keep declaration order. | elk.test "model order" |
| R7 | A connection whose end is a group attaches to that group's frame; an empty group is drawn as a frame of minimum size. | layoutContract "(group endpoints)" |
| R8 | An entity is drawn by its state's look and its kind's glyph or frame, never by the names; a custom look or kind renders exactly its style object; an author's reason is its tooltip. | render.test "looks and kinds (R8)" |
| R9 | A legend lists every non-default state used in a view with its look and description. | render.test "legend (R9)" |
| R11 | A closed group is drawn as one box the size of a component: its name centred, an expand mark, nothing inside. Its members and everything below them leave the view; connections to them re-attach to the box, and several onto one pair of boxes merge into one line with their loads summed. Every set of open groups is its own layout. Opening or closing a group (a scene's `open`, a click on a closed box, or a page's call) moves the picture to that layout: shared entities slide, frames resize, edges are swapped, what appears fades in once settled. Zooming is a separate action (a scene's `zoom`, Enter or a double-click, or a page's call): the camera closes on one entity in whatever layout is showing, and opening does not zoom. Closed groups nest to any depth; opening an inner one means its closed ancestors are open too. Escape zooms out first, then closes the innermost open group. The interactive file carries one layer per way the view's closed groups can be open. | view.test "collapsed groups (R11)"; render.test "closed groups (R11)"; boot.test "drill-down" |
| R12 | A tour whose scenes share one view is one drawing that moves. Each scene says which closed groups are open and what the camera closes on, every distinct set of open groups has its own layout, and the drawing holds the union of entities: each has a position track, a visibility track and one variant per state it takes; a group's frame also has a size track and swaps its title for its summary. Edges are one set per distinct drawing. A transition has three phases that never overlap: what leaves fades (caption, entities, edges), then positions, sizes and the camera ease to the new layout, then what arrives fades in. States crossfade over the whole window. The camera closes on the scene's zoom in its layout, or fits the whole layout, clipped to the stage; the legend and caption are a fixed strip below. Everything shown per scene carries whether it is visible at t = 0, so a still keeps exactly the first scene. Scenes across views crossfade between whole views. | render.test "tour of views (R12)"; raster document.test "tours"; boot.test "runtime tour" |
| R10 | A playing view carries one complete layer per step on one shared layout, cycled by CSS with the declared period, each captioned with its step note; frame tooling inspects the base step; the runtime replaces the cycle with its own timer, stopped by the first interaction. | render.test "plays a scenario (R10)"; raster document.test "playing views"; boot.test "autoplay" |

## 7. Non-goals (v1)

- Performance, latency or capacity modelling. Load is relative and cosmetic.
- Computing states. What a failure does to the rest of the system is the author's to say; the tool draws it.
- Flowcharts, ER, class, state machines, Gantt.

## 8. Reserved

`interactions` (ordered messages over connections, for sequence and walkthrough views), view `type` values
`sequence` and `walkthrough`, `tags` on entities and by-tag view selection, `around` (neighbourhood) views,
vocabulary packs (`states.use`, `kinds.use`).

## 9. Decisions

Recorded so the reasoning is not lost. Dates are 2026-09-05.

- **Component = one deployment in one place.** Multi-region systems are several components grouped by region.
  Keeps health per instance and makes deployment views work with plain groups.
- **Nothing is inferred (2026-09-05).** Two earlier designs computed states: first from edge fields (`dependsOn`,
  `fallback`), then from `needs` on components with alternatives, quorum, rank, availability, cascade and load
  shifting. Both grew a rulebook the author had to learn and then argue with, and neither could say that something
  *does not* fail (a buffer, a bulkhead). Now every state, reason and load in a picture is one the author wrote.
  Connection kinds became author-defined line styles at the same time, so emphasis is the author's too.
- **Connections to groups, including empty ones,** after first rejecting them for layout reasons. A group is an
  entity with a state of its own; layout risk is an adapter problem.
- **A group's state is its own.** Setting a region off does not set its members; list them. Explicit beats a
  cascade rule that then needs tie-breaking.
- **Vocabulary is the author's.** Fixed system states (and the word "down") were removed from the engine. Defaults
  reproduce the old behaviour exactly.
- **Rejected:** health expressions (a second syntax inside JSON); inferring anything from connections; a linter
  that argues with the author's scenario; default connection ids like `a->b` in the user-facing model.
