---
name: orrery-pr
description: This skill should be used when the user asks to "open a pull request", "make a PR", "write the PR description", "put the pictures in the PR", or when a change to Orrery is ready for review. It gives every pull request the same shape: what and why, the model change with its invariant and a JSON example, the pictures embedded as the SVG files themselves, the tests, the docs, and the performance ratchet's verdict.
---

# Pull requests for Orrery

A pull request is read by someone who did not watch the work. It shows the change, not the effort: the invariant
that moved, the JSON that exercises it, the pictures it produces, the tests that hold it, and what the ratchet
measured. Write it in the same order every time.

## Before writing

1. `yarn check` passes locally. It runs typecheck, lint, every suite, and the performance ratchet alone.
2. `yarn examples` has regenerated the pictures, and they were looked at (`yarn inspect <file>` or a browser).
3. The branch is pushed. Pictures are embedded from the branch, so they must exist there first.
4. If the ratchet flagged growth the change means (a bigger runtime, a bigger document), decide the metrics and the
   reason now. Undeclared growth blocks the merge; declared growth is written in the body (below).

## A bug: replicate the report, then show it resolved

A fix for a reported bug carries the reporter's own model, unchanged, as `fixtures/issues/<number>-<slug>.json`,
and a case in `packages/core/test/issues.test.ts` whose assertion is the symptom they described. Not the cause,
the symptom: if they said a box drew outside its frame, assert that every box is inside its frame.

Check it the only way that proves anything. Run the new test against the unfixed code, watch it fail, and put the
failure message in the pull request beside the fix. A test that covers only the cause can pass while the
reporter's own picture is still wrong, and they are the one who will look.

The body then carries three things: their model as the JSON example, the failure message from before the fix, and
the picture after it. Say "Fixes #n" so the issue closes on merge.

## Pictures: embed the SVG files, never screenshots

GitHub renders an SVG file from the branch inside an image tag, animation included. Embed every picture the change
adds or alters, from the branch the pull request comes from:

```markdown
![A customer checks out](https://raw.githubusercontent.com/adamgilman/Orrery/<branch>/examples/checkout/8-sequence.svg)
```

`node tools/pr-images.mjs <file.svg> [...]` prints these lines for the current branch. A before-and-after pair
uses the same path on `main` and on the branch.

## The body

Use this shape; drop a section only when it truly has nothing to say.

```markdown
## What
One paragraph: what changes for someone using Orrery, in their terms.

## Why
The problem, the request, or the link to the issue.

## Model
The block or field added or changed, the invariant it adds or changes (Rn or Sn in docs/MODEL.md), and a JSON
example, as a fenced `json` block. If the schema changed, say which property and what its description says.

The example is a **complete model a reader can copy into a file and run**, not a fragment: the smallest whole
model that exercises the invariant, with the `components` and `connections` it needs to validate. A reader should
be able to save it and get a picture:

```sh
orrery render example.orrery.json -o example.svg      # or: pbpaste | orrery render - -o example.svg
```

Check it before pasting it in. An example that does not validate is worse than none, because a reviewer will try
it. A fragment is fine only as a second block, to point at the one field under discussion, and only beside the
whole model, never instead of it.

A change with no model surface says so in one line and carries no JSON. A change that only moves code says which
invariant it now enforces that it did not, and gives the model that used to slip through.

## Pictures
Every picture the change adds or alters, embedded from the branch. One line of caption each: what to look at.
Name the kind of drawing in the caption: the **topology** (the classic Orrery drawing: entities and the
connections between them, groups as frames) or a **sequence** (one interaction's messages on lifelines). When a
change touches a sequence, show the topology of the same model beside it, so the reader sees that both are
drawings of one file.

## Tests
Which suites gained what: the unit test that came first, the fixture, the place in the diagram of Orrery
(examples/orrery.orrery.json) that draws the feature so the regression suite sees it.

## Docs
MODEL.md (section and invariant), README stage or reference page, the skill's variants, CHANGELOG under Unreleased.

## Performance
The ratchet's verdict. If the change grows a metric on purpose, declare it on one line so the workflow accepts it
and resets the baseline when this merges:

perf-accept: runtime.bytes, document.bytes (the runtime learned to step messages)

## Checklist
- [ ] A failing test came first; `yarn check` passes.
- [ ] Model changes: MODEL.md updated, an invariant added or changed with its test, the schema says the same.
- [ ] Pictures regenerated with `yarn examples` and embedded above.
- [ ] The diagram of Orrery exercises the feature; the skill's variants show it.
```

End the body with the attribution lines the session requires.

## Opening and updating

```sh
gh pr create --title "<what, as a sentence>" --body-file /path/to/body.md
gh pr edit <n> --body-file /path/to/body.md    # after a push that changes the pictures or the ratchet's verdict
```

The title is one sentence of what changes, not how: "Sequence views: one interaction's messages as a diagram of
the same model", not "Add sequence.ts".

## Reviewing what comes back

The ratchet comments its table on the pull request and updates it on every push; read it before asking for
review. CI must be green: `lint` and `test` are required on main.
