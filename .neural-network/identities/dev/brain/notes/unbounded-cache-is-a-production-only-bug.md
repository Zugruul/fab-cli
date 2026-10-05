---
tags: [memory, caching, scale, streaming, measurement, determinism]
paths: []
strength: 1
source: ""
confidence: direct
learned-from: task 272, 2026-08-05
graduated: false
created: 2026-08-05
last-touched: 2026-08-05
---

# O(n) resource growth is invisible at test scale and fatal at production scale

Any cache keyed by an input identifier, without an explicit bound, is a latent
production-only failure. Fixtures never reach the scale where it matters.

Worked example: a generator's decoded-source-image cache was an unbounded
`Map`. Fine at 500-2,000 items. At production scale the job **visits nearly
every distinct input by design**, so the cache grew without limit: RSS climbed
linearly ~11 MB per item (real inputs decoded to ~12 MB each) to 8.7 GB, then
SIGKILL — with **zero output written**, because results were also accumulated
and flushed only at the end.

**Note the interaction that made it pathological:** a mode designed to touch
every distinct input is exactly what turns a benign "cache what we've seen"
into unbounded growth. Coverage/exhaustive modes deserve a second look at every
cache they touch.

**Verification that actually works — measure, don't read:**
sample the **real worker process's** RSS over time at two very different
scales. A flat curve is the evidence; a linear one is the bug. Do this both to
find it and as the fix's acceptance criterion — far stronger than "the failure
stopped happening."

Watch the right process: a wrapper (npm/tsx shim) shows ~1 MB and looks idle
while the real worker balloons.

**Design rules:** bound every identifier-keyed cache (LRU, config-sized);
stream results to disk as produced rather than accumulating; keep only counters
and hashes in memory. Keep the cache-size knob **out of** any config that feeds
a determinism hash, so tuning it can never perturb reproducibility.

Related: [[mechanism-correct-but-never-triggered]], [[verification-has-an-axis]].
