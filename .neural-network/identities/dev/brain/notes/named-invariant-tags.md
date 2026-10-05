---
tags: [invariants, comments, discoverability]
paths: ["pipeline/**"]
strength: 1
source: "PR#246 #244 retro"
confidence: direct
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

A cross-file invariant living as repeated prose comments (PR#246: 'always draw, even if discarded' stream-shape discipline) should get ONE greppable tag (e.g. // INVARIANT: draw-shape) at each site pointing to a single canonical explanation — and ideally a static test enforcing it (the rngGuard pattern). Prose-per-call-site is invisible to grep-by-concept; the next dev finds it only by luck or analogy.

Related: [[test-knob-intersections]]
