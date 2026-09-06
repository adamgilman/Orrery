# The performance ratchet

`benchmark.orrery.json` is a frozen model of fixed size: three regions, three tiers each, 35 components, 67
connections, a scenario, a tour, six exports. It is not a real system and it is never edited for features; the
ratchet measures the tool, so the input must stay the same. If a schema change ever forces an edit, regenerate it
with `node tools/bench-model.mjs`, reset the baseline (`ORRERY_PERF_RESET=1 yarn perf:ratchet`) and say why in
the commit.

`baseline.json` is the ratchet. Every metric in it may only go down:

- **Deterministic metrics** (bytes of output, layers, layout calls) are held exactly. Worse fails the build. Better
  by more than the tolerance also fails, until `yarn perf:ratchet` locks the gain in; commit the new baseline with
  the change that earned it.
- **Timings** (milliseconds, median of several runs) are held with slack: 1.25× locally, 3× in CI, plus two
  milliseconds so jitter on a sub-millisecond median is not a regression. A slow runner cannot cry wolf but a
  real regression cannot hide. `yarn perf:ratchet` tightens them only when run on the
  maintainer's machine and only downwards.

`yarn perf` prints the table and enforces it, on its own after the suite (`yarn check`, and the CI test job): timings
measured beside other test workers are not timings of the tool, so the ratchet is not part of `yarn test`.
