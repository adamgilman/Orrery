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
The block or field added or changed, the invariant it adds or changes (Rn or Sn in docs/MODEL.md), and the
smallest JSON that exercises the invariant, as a fenced json block. If the schema changed, say which property
and what its description says.

## Pictures
Every picture the change adds or alters, embedded from the branch. One line of caption each: what to look at.

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
