# What the validator says

Generated from fixtures/invalid by tools/skill-refs.mjs. Every error is one line, `<file>:<json-pointer>: <message>`,
on stderr, exit code 1. Fix at the pointer. The message names what is known when a name is unknown, so the fix is
usually to pick from the list or define the name in `states`, `kinds` or `shapes`.

Warnings are the same shape with `(warning)` and do not fail: today, a source connected both to a group and to
something inside it, and a view whose closed groups can be open in more than 32 combinations.

### ambiguous-connection-ref

- `/scenarios/0/steps/0/load/0`: refer to one by id

Provoked by: `{"components":[{"id":"a"},{"id":"b"}],"connections":[{"id":"r","from":"a","to":"b"},{"id":"w","from":"a","to":"b"}],"scenarios":[{"id":"s","steps":[{"load":[{"from":"a","to":"b","load":1}]}]}]}`

### bad-colour

- `/states/define/hot/look/stroke`: is not a CSS colour
- `/kinds/groups/g/frame/fill`: is not a CSS colour
- `/kinds/connections/c/line/flow`: is not a CSS colour

Provoked by: `{"states":{"define":{"hot":{"look":{"stroke":"red}</style><script>alert(1)</script>"}}}},"kinds":{"groups":{"g":{"frame":{"fill":"url(x)"}}},"connections":{"c":{"line":{"flow":"url(x)"}}}},"components":[{"id":"a"}]}`

### bad-direction

- `/direction`: must be one of: right, down

Provoked by: `{"direction":"left","components":[{"id":"a"}]}`

### bad-glyph-object

- `/kinds/components/k/glyph/svg`: plain SVG markup

Provoked by: `{"kinds":{"components":{"k":{"glyph":{"viewBox":"0 0 16 16","svg":"<image href=\"x.png\"/>"}}}},"components":[{"id":"a","kind":"k"}]}`

### bad-glyph

- `/kinds/components/k/glyph`: preset glyph

Provoked by: `{"kinds":{"components":{"k":{"glyph":"circle"}}},"components":[{"id":"a"}]}`

### bad-id

- `/components/0/id`: must match pattern

Provoked by: `{"components":[{"id":"has space"}]}`

### bad-line

- `/kinds/connections/x/line`: must be one of: solid, dashed, dotted, heavy

Provoked by: `{"kinds":{"connections":{"x":{"line":"wavy"}}},"components":[{"id":"a"}]}`

### bad-look

- `/states/define/x/look`: must be one of: normal, warn, alert, muted, highlight

Provoked by: `{"states":{"define":{"x":{"look":"pink"}}},"components":[{"id":"a"}]}`

### bad-shape

- `/shapes/define/a/path`: SVG path data
- `/shapes/define/b`: either path or corner, not both
- `/shapes/define/c`: needs path or corner
- `/kinds/components/k/shape`: unknown shape "octagon"; known: box, sharp, pill, ellipse, cylinder, hexagon, diamond, parallelogram, document, card, cloud, a, b, c

Provoked by: `{"shapes":{"define":{"a":{"path":"circle"},"b":{"path":"M0 0H100V100Z","corner":4},"c":{"pad":{"x":2,"y":2}}}},"kinds":{"components":{"k":{"shape":"octagon"}}},"components":[{"id":"x","kind":"k"}]}`

### bad-view-type

- `/views/0/type`: must be one of: topology

Provoked by: `{"components":[{"id":"a"}],"views":[{"id":"v","type":"sequence"}]}`

### collapse-not-a-group

- `/views/0/collapse/0`: "a" is not a group
- `/views/1/collapse/0`: unknown group "zzz"

Provoked by: `{"groups":[{"id":"g"}],"components":[{"id":"a","group":"g"}],"views":[{"id":"v","collapse":["a"]},{"id":"w","collapse":["zzz"]}]}`

### collapse-outside-scope

- `/views/0/collapse/0`: not inside scope "g"

Provoked by: `{"groups":[{"id":"g"},{"id":"h"}],"components":[{"id":"a","group":"g"},{"id":"b","group":"h"}],"views":[{"id":"v","scope":"g","collapse":["h"]}]}`

### connection-to-ancestor

- `/connections/0`: contain one another

Provoked by: `{"groups":[{"id":"g"}],"components":[{"id":"a","group":"g"}],"connections":[{"from":"a","to":"g"}]}`

### duplicate-connection-id

- `/connections/1/id`: duplicate connection id "x"

Provoked by: `{"components":[{"id":"a"},{"id":"b"},{"id":"c"}],"connections":[{"id":"x","from":"a","to":"b"},{"id":"x","from":"a","to":"c"}]}`

### duplicate-id

- `/components/2/id`: duplicate component id "a"

Provoked by: `{"components":[{"id":"a"},{"id":"b"},{"id":"a"}]}`

### duplicate-view-id

- `/views/1/id`: duplicate view id "v"

Provoked by: `{"components":[{"id":"a"}],"views":[{"id":"v"},{"id":"v"}]}`

### export-duplicate-id

- `/exports/1/id`: duplicate export id "x"

Provoked by: `{"groups":[{"id":"g"}],"components":[{"id":"a"},{"id":"p","group":"g"}],"connections":[{"from":"a","to":"p"}],"views":[{"id":"v","collapse":["g"]},{"id":"open"}],"scenarios":[{"id":"s","steps":[{"set":{"failed":"a"}}]}],"exports":[{"id":"x"},{"id":"x"}]}`

### export-play-and-scenario

- `/exports/0/play`: play and scenario are exclusive
- `/exports/1/seconds`: seconds needs play

Provoked by: `{"groups":[{"id":"g"}],"components":[{"id":"a"},{"id":"p","group":"g"}],"connections":[{"from":"a","to":"p"}],"views":[{"id":"v","collapse":["g"]},{"id":"open"}],"scenarios":[{"id":"s","steps":[{"set":{"failed":"a"}}]}],"exports":[{"id":"x","play":"s","scenario":"s"},{"id":"y","seconds":2}]}`

### export-tour-without-tour

- `/exports/0/tour`: the model has no tour
- `/exports/0/open`: a tour export takes no other field

Provoked by: `{"groups":[{"id":"g"}],"components":[{"id":"a"},{"id":"p","group":"g"}],"connections":[{"from":"a","to":"p"}],"views":[{"id":"v","collapse":["g"]}],"scenarios":[{"id":"s","steps":[{"set":{"failed":"a"}}]}],"exports":[{"id":"x","tour":true,"open":["g"]}]}`

### export-unknown-view

- `/exports/0/view`: unknown view "nope"

Provoked by: `{"groups":[{"id":"g"}],"components":[{"id":"a"},{"id":"p","group":"g"}],"connections":[{"from":"a","to":"p"}],"views":[{"id":"v","collapse":["g"]},{"id":"open"}],"scenarios":[{"id":"s","steps":[{"set":{"failed":"a"}}]}],"exports":[{"id":"x","view":"nope"}]}`

### group-cycle

- `/groups/0/parent`: group cycle
- `/groups/1/parent`: group cycle
- `/groups/2/parent`: group cycle

Provoked by: `{"groups":[{"id":"g1","parent":"g2"},{"id":"g2","parent":"g1"},{"id":"g3","parent":"g3"}],"components":[{"id":"a"}]}`

### id-clash-component-group

- `/components/0/id`: id "shared" is already used by a group

Provoked by: `{"groups":[{"id":"shared"}],"components":[{"id":"shared"}]}`

### load-out-of-range

- `/connections/0/load`: must be <= 1

Provoked by: `{"components":[{"id":"a"},{"id":"b"}],"connections":[{"from":"a","to":"b","load":1.5}]}`

### load-ref-both

- `/scenarios/0/steps/0/load/0`: not both

Provoked by: `{"components":[{"id":"a"},{"id":"b"}],"connections":[{"id":"x","from":"a","to":"b"}],"scenarios":[{"id":"s","steps":[{"load":[{"id":"x","from":"a","to":"b","load":1}]}]}]}`

### missing-components

- ``: missing required property "components"

Provoked by: `{"connections":[]}`

### not-an-object

- ``: must be an object

Provoked by: `[1,2,3]`

### only-outside-scope

- `/views/0/only/0`: not inside scope "g"

Provoked by: `{"groups":[{"id":"g"}],"components":[{"id":"a","group":"g"},{"id":"b"}],"views":[{"id":"v","scope":"g","only":["b"]}]}`

### open-and-zoom

- `/exports/0/open/0`: is not closed in view "open"
- `/exports/1/open/0`: is not a group
- `/exports/2/open/0`: is inside "g", which is closed; open "g" too
- `/exports/3/zoom`: "q" is inside "h", which is closed here
- `/tour/scenes/1/open/0`: is inside "g", which is closed; open "g" too

Provoked by: `{"groups":[{"id":"g"},{"id":"h","parent":"g"}],"components":[{"id":"a"},{"id":"p","group":"g"},{"id":"q","group":"h"}],"connections":[{"from":"a","to":"p"}],"views":[{"id":"v","collapse":["g","h"]},{"id":"open"}],"scenarios":[{"id":"s","steps":[{"set":{"failed":"a"}}]}],"exports":[{"id":"x","view":"…`

### parallel-without-ids

- `/connections/0`: several connections
- `/connections/1`: several connections

Provoked by: `{"components":[{"id":"a"},{"id":"b"}],"connections":[{"from":"a","to":"b"},{"from":"a","to":"b"}]}`

### play-unknown-scenario

- `/views/0/play/scenario`: unknown scenario "nope"

Provoked by: `{"components":[{"id":"a"}],"views":[{"id":"v","play":{"scenario":"nope"}}]}`

### prototype-names

- `/components/0/state`: unknown state "toString"
- `/components/0/kind`: unknown component kind "valueOf"

Provoked by: `{"components":[{"id":"a","state":"toString","kind":"valueOf"}]}`

### replace-without-default

- `/states/default`: states.replace is true, so states.default must name one of: ok

Provoked by: `{"states":{"replace":true,"define":{"ok":{"look":"normal"}}},"components":[{"id":"a"}]}`

### scenario-conflicting-verbs

- `/scenarios/0/steps/0/set/off/0`: already set
- `/scenarios/0/steps/1/restore`: both set and restored

Provoked by: `{"components":[{"id":"a"}],"scenarios":[{"id":"s","steps":[{"set":{"failed":"a","off":["a"]}},{"set":{"failed":"a"},"restore":"a"}]}]}`

### scenario-duplicate-id

- `/scenarios/1/id`: duplicate scenario id "s"

Provoked by: `{"components":[{"id":"a"}],"scenarios":[{"id":"s","steps":[{"set":{"off":"a"}}]},{"id":"s","steps":[{"set":{"failed":"a"}}]}]}`

### scenario-empty-step

- `/scenarios/0/steps/0`: step changes nothing

Provoked by: `{"components":[{"id":"a"}],"scenarios":[{"id":"s","steps":[{"note":"nothing happens"}]}]}`

### scenario-unknown-connection

- `/scenarios/0/steps/0/load/0`: no connection from "b" to "a"

Provoked by: `{"components":[{"id":"a"},{"id":"b"}],"connections":[{"from":"a","to":"b"}],"scenarios":[{"id":"s","steps":[{"load":[{"from":"b","to":"a","load":1}]}]}]}`

### scenario-unknown-entity

- `/scenarios/0/steps/0/set/failed`: unknown entity "ghost"

Provoked by: `{"components":[{"id":"a"}],"scenarios":[{"id":"s","steps":[{"set":{"failed":"ghost"}}]}]}`

### scenario-unknown-state

- `/scenarios/0/steps/0/set/broken`: unknown state "broken"

Provoked by: `{"components":[{"id":"a"}],"scenarios":[{"id":"s","steps":[{"set":{"broken":"a"}}]}]}`

### self-connection

- `/connections/0`: to itself

Provoked by: `{"components":[{"id":"a"}],"connections":[{"from":"a","to":"a"}]}`

### shapes-replace-without-box

- `/shapes/define`: shapes.replace is true, so "box" must be defined

Provoked by: `{"shapes":{"replace":true,"define":{"hex":{"path":"M15 0H85L100 50 85 100H15L0 50Z"}}},"components":[{"id":"x"}]}`

### tour-bad-scene

- `/tour/scenes/1/scenario`: unknown scenario "zzz"
- `/tour/scenes/2/step`: between 1 and 1
- `/tour/scenes/3/set/broken`: unknown state "broken"

Provoked by: `{"components":[{"id":"a"}],"views":[{"id":"v"}],"scenarios":[{"id":"s","steps":[{"set":{"failed":"a"}}]}],"tour":{"scenes":[{"view":"v"},{"view":"v","scenario":"zzz"},{"view":"v","scenario":"s","step":9},{"view":"v","set":{"broken":"a"}}]}}`

### tour-bad-zoom

- `/tour/scenes/1/open/0`: "b" is not a group
- `/tour/scenes/2/open/0`: unknown group "zzz"
- `/tour/scenes/2/zoom`: unknown entity "zzz"

Provoked by: `{"groups":[{"id":"g"}],"components":[{"id":"a","group":"g"},{"id":"b"}],"views":[{"id":"v","collapse":["g"]}],"tour":{"scenes":[{"view":"v"},{"view":"v","open":["b"]},{"view":"v","open":["zzz"],"zoom":"zzz"}]}}`

### tour-empty

- `/tour`: give views or scenes

Provoked by: `{"components":[{"id":"a"}],"tour":{"seconds":2}}`

### tour-unknown-view

- `/tour/views/1`: unknown view "nope"

Provoked by: `{"components":[{"id":"a"}],"views":[{"id":"v"}],"tour":{"views":["v","nope"]}}`

### unknown-connection-kind

- `/connections/0/kind`: unknown connection kind "telepathy"

Provoked by: `{"components":[{"id":"a"},{"id":"b"}],"connections":[{"from":"a","to":"b","kind":"telepathy"}]}`

### unknown-entity

- `/connections/0/to`: unknown entity "zzz"

Provoked by: `{"components":[{"id":"a"}],"connections":[{"from":"a","to":"zzz"}]}`

### unknown-group-kind

- `/groups/0/kind`: unknown group kind "cell"

Provoked by: `{"groups":[{"id":"g","kind":"cell"}],"components":[{"id":"a"}]}`

### unknown-group

- `/components/0/group`: unknown group "nope"

Provoked by: `{"components":[{"id":"a","group":"nope"}]}`

### unknown-kind

- `/components/0/kind`: unknown component kind "mainframe"

Provoked by: `{"components":[{"id":"a","kind":"mainframe"}]}`

### unknown-only

- `/views/0/only/1`: unknown entity "zzz"

Provoked by: `{"components":[{"id":"a"}],"views":[{"id":"v","only":["a","zzz"]}]}`

### unknown-pack

- `/kinds/use/0`: unknown pack "ibm"; known: aws, azure, gcp, sre

Provoked by: `{"kinds":{"use":["ibm"]},"components":[{"id":"a"}]}`

### unknown-parent

- `/groups/0/parent`: unknown group "ghost"

Provoked by: `{"groups":[{"id":"g1","parent":"ghost"}],"components":[{"id":"a"}]}`

### unknown-property

- `/components/0`: unknown property "x"
- ``: unknown property "layers"

Provoked by: `{"components":[{"id":"a","x":10}],"layers":[]}`

### unknown-scope

- `/views/0/scope`: unknown group "nope"

Provoked by: `{"components":[{"id":"a"}],"views":[{"id":"v","scope":"nope"}]}`

### unknown-state

- `/components/0/state`: unknown state "broken"

Provoked by: `{"components":[{"id":"a","state":"broken"}]}`
