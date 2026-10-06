---
tags: [review, collisions, naming]
paths: ["pipeline/**"]
strength: 1
source: "PR#243 APP-029 retro"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

Wherever a filename or key is DERIVED (not generated) from caller input and later used as a write target or dedup key, construct two distinct inputs that collide on the derived name and verify the system refuses rather than overwrites. General form: any N:1 derivation feeding a disk write or index insert needs its own explicit collision test — fixture authors habitually pick distinct names, so happy-path suites hide the gap forever. Found PR#243's silent pack corruption this way against 55 green tests.

Related: [[mutation-test-monotonic-fixtures]] [[execute-load-bearing-mechanism-claims]]
