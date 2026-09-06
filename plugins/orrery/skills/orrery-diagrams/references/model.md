# The model, field by field

Generated from docs/MODEL.md §4 by tools/skill-refs.mjs; edit the specification, not this file. Invariant numbers
(R…, S…) name the rules and tests in the specification. Every field here is also described in the JSON Schema.

### 4.1 Document

| Field | Type | Default | Meaning |
|---|---|---|---|
| `$schema` | string | | Schema URL, for editor support. |
| `title` | string | | Title of the system. Shown on views that do not set their own. |
| `description` | string | | What the system is, in a sentence or a paragraph. With the title it is the heading block a picture carries when asked (R15). |
| `direction` | `right` \| `down` | `right` | Default flow direction for views. The only layout hint at this level. |
| `states` | object | the default set | See 4.7. |
| `kinds` | object | the default set | See 4.8. |
| `components` | array, at least one | required | See 4.2. |
| `connections` | array | `[]` | See 4.3. |
| `groups` | array | `[]` | See 4.4. |
| `views` | array | one view of everything | See 4.5. |
| `scenarios` | array | `[]` | See 4.6. |
| `callouts` | array of callout | `[]` | Standing annotations, drawn on every picture (4.6). |
| `exports` | array of export | `[]` | The files to write from this model, one picture or animation each: `orrery export` renders them all (4.9). |
| `tour` | `{ seconds, scenes }` or `{ seconds, views }` | | A story told on a timer. Each scene is a view at a moment: `{ view, open?, zoom?, scenario?, step?, set?, callouts?, note?, seconds? }`. `open` lists the closed groups drawn open and `zoom` names what the camera closes on; they are separate actions, so a scene can open two groups and stay zoomed out, or zoom in on one. `views` is shorthand for one scene per view. When every scene shares one view, the file is one drawing that moves between layouts in CSS, so it plays inside an image tag; the runtime does the same until the reader interacts (R12). |

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
| `description` | string | document description | What this view shows; with its title, the heading block for pictures of this view. |
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
| `callouts` | array of `{ at, text, side? }` | Notes drawn at this step only: `at` is an entity id or a connection id, `text` the explanation, `side` (`top`, `right`, `bottom`, `left`) pins the note; without it the note goes where there is room. The next step says its own thing (R16). |
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
| `use` | | A states pack shipped with the tool (`sre`), or a list. A pack is a whole vocabulary: it stands in for the defaults, as `replace` does, and `define` merges onto it. `orrery packs` lists them. |

### 4.8 Kinds

`kinds` binds component, group and connection kind names to representation, the same way.

```jsonc
"kinds": {
  "replace": false,
  "components": {
    "mainframe": { "glyph": "storage", "shape": "cylinder", "description": "z/OS LPAR" }, // a preset glyph and shape
    "sidecar":   { "glyph": "M2 2h12v12H2z", "box": { "dash": true } },       // or an SVG path in a 16×16 box
    "acme:vault": { "glyph": { "viewBox": "0 0 64 64", "svg": "<path fill=\"#7aa116\" d=\"…\"/>" } } // or an icon
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

A glyph is a preset name, SVG path data drawn with the theme's stroke in a 16×16 box, or an icon object: `viewBox`
and `svg`, the icon's own markup in its own colours, drawn as a nested `<svg>` in the glyph slot. Icon markup is
pictures only: no script, foreignObject, image, style or event handlers (S15).

**Shapes.** A component kind or a group kind names its outline with `shape`; a kind without one is drawn as
`box`. A group's shape frames its members when open, with the pad as extra inset on every side, and is its box
when closed. The presets
are `box` (rounded), `sharp`, `pill`, `ellipse`, `cylinder`, `hexagon`, `diamond`, `parallelogram`, `document`,
`card` and `cloud`, and the default kinds bind `database` to `cylinder`, `queue` to `parallelogram`, `gateway`
to `hexagon`, `client` to `pill` and `external` to `cloud`. A top-level `shapes` block defines your own the way
`states` does: define an existing name to override it, a new name to extend, `replace: true` to keep only yours
(then `box` must be among them).

```jsonc
"shapes": {
  "define": {
    "chevron": { "path": "M0 0H85L100 50 85 100H0L15 50Z", "pad": { "x": 16, "y": 0 }, "description": "A pipeline stage" },
    "box":     { "corner": 2 }
  }
}
```

An outline is `path`, SVG path data in a 100×100 box scaled to the component's size, or `corner`, a rounded
rectangle with that radius in px (`"round"` for a pill); one or the other. `pad` is the room the label needs to
clear the outline, per side, declared rather than computed. A pack's `shapes` come in with `kinds.use`, prefixed
like its kinds.

**Packs.** `"use": ["aws"]` pulls in a vocabulary shipped with the tool (docs/PACKS.md). A kinds pack's names are
prefixed with the pack's name, `aws:s3`, `gcp:cloud-run`, `azure:sql-database`, so a kind name may carry one
`:`; authors may namespace their own kinds the same way. Packs merge after the defaults and before the author's
own definitions, later packs over earlier ones; `replace: true` drops the defaults and keeps the packs asked for.
`aws`, `azure` and `gcp` carry every icon in the provider's own set, under a name derived from the provider's
and under the names people say (`aws:s3`, `gcp:run`, `azure:aks`), plus a few group kinds as frames in the
provider's colours. `orrery packs <name>` lists a pack.

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
| `tour` | `true`: the model's tour, as one drawing that moves. Exclusive with every field but `id` and `heading`. |
| `callouts` | Notes for this picture, with the what-if, as a scenario step's (R16). |
| `heading` | `true`: draw the title and description block above the picture (R15): the view's own, else the model's, with the text centred; `"left"` sets it at the left edge. `render --heading [left]` does the same from the command line, for a still or the interactive file. Off by default: a document introduces its pictures in its own prose. |

`play` and `scenario` are exclusive (S16).

### 4.10 Warnings

The validator reports, without failing, a source that connects both to a group and to something inside it: both
lines will be drawn, which is usually a mistake. Warnings carry a pointer like errors.
