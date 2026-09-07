# The performance ratchet

`benchmark.orrery.json` is a frozen model of fixed size: three regions, three tiers each, 35 components, 67
connections, a scenario, a tour, six exports. It is not a real system and it is never edited for features; the
ratchet measures the tool, so the input must stay the same. If a schema change ever forces an edit, regenerate it
with `node tools/bench-model.mjs`, delete `baseline.json` so CI measures afresh, and say why in the commit.

`baseline.json` is the ratchet. Nobody edits it by hand:

- **Every pull request** runs `perf.test.ts` against it and posts the table as a comment on the pull request,
  updated on every push. A metric worse than the baseline fails the required check and blocks the merge: bytes
  and counts exactly, timings with slack (1.6× on the runner, plus two milliseconds so jitter on a sub-millisecond
  median is not a regression). Better is simply fine.
- **Every push to main** measures again, writes `min(baseline, measured)` for every metric, and commits the file
  back to main as `github-actions[bot]` through a deploy key the branch ruleset lets through. A gain is kept the
  moment it lands; the baseline can only go down, and `git log test/perf/baseline.json` is the record.
- **Growth a change means** is declared, not smuggled: a line `perf-accept: runtime.bytes, document.bytes` in the pull
  request body, with the reason beside it. Those metrics show as accepted growth instead of failing, and when the
  pull request merges the ratchet resets them to what was measured. Everything else still may only improve.
- **The `perf-ignore` label** accepts every metric, for a pull request whose performance is not its point: the
  table is still measured and posted, nothing blocks, and the baseline resets to what was measured on merge.
  Dependabot's pull requests carry it, so a dependency that costs bytes lands and the next change is judged from
  there rather than blocked on someone else's regression. A push to main is judged by what the pull request it
  merged accepted, so the ratchet job runs after it and resets those metrics.

Locally, `yarn perf` prints the same table with looser slack, since a laptop is not the runner. It runs alone,
after the suite, in `yarn check` and in the CI test job: timings measured beside other test workers are not timings
of the tool.
