---
tags: [review, mutation-testing, test-quality]
paths: ["pipeline/**", "fab-cli/**", "fab-app/**"]
strength: 1
source: "PR#255 #253 retro"
confidence: direct
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

Three compounding weak-test tells for choosing mutation-test targets: (1) INEQUALITY/negative assertions (.not.toBe) — pass on ANY difference, not the guarded one; (2) tests RETROFITTED after a manual/eyeball catch — the author never saw a failing-then-passing cycle, so discrimination was never proven; (3) the asserted value sits DOWNSTREAM of an intervening transform (translate/rotate/hash/serialize) from the logic under test — check whether the transform alone produces the 'difference'. One tell nudges; all three = mutation-test it first. PR#255: all three on one test, mutation survived the full suite.

Related: [[mutation-test-monotonic-fixtures]] [[execute-load-bearing-mechanism-claims]]
