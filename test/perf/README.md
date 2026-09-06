# The performance ratchet

`benchmark.orrery.json` is a frozen model of fixed size: three regions, three tiers each, 35 components, 67
connections, a scenario, a tour, six exports. It is not a real system and it is never edited for features; the
ratchet measures the tool, so the input must stay the same. If a schema change ever forces an edit, regenerate it
with `node tools/bench-model.mjs`, delete the `PERF_BASELINE` repository variable so CI measures afresh, and say why
in the commit.

The baseline is the repository variable `PERF_BASELINE`. Nobody edits it:

- **Every pull request** runs `perf.test.ts` against it and posts the table as a comment on the pull request,
  updated on every push. A metric worse than the baseline fails the required check and blocks the merge: bytes
  and counts exactly, timings with slack (1.6× on the runner, plus two milliseconds so jitter on a sub-millisecond
  median is not a regression). Better is simply fine.
- **Every push to main** measures again and stores `min(baseline, measured)` for every metric. A gain is kept the
  moment it lands; the baseline can only go down. The table goes into the run's summary, so the history is on the
  Actions page.

Locally, `yarn perf` prints the same table against the variable (through `gh`, if you are logged in) with looser
slack, since a laptop is not the runner. It runs alone, after the suite, in `yarn check` and in the CI test job:
timings measured beside other test workers are not timings of the tool.
