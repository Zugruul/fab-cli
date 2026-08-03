---
tags: [algorithms, math, boundaries]
paths: ["pipeline/**"]
strength: 1
source: "PR#240 APP-028 retro"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

When implementing a named published algorithm (ArcFace, NMS, Kalman, ...), cross-check a canonical reference implementation's GUARD CLAUSES before treating a from-the-paper derivation as complete. References accumulate thresholds/clamps/piecewise fallbacks because someone hit the edge in production — reproducing the elegant formula while dropping the ugly guard is how PR#240 shipped the pi-margin reversal. The check is cheap: read the reference's boundary handling, sweep your formula's full input domain numerically.

Related: [[boundary-convention-before-first-test]] [[test-knob-intersections]]
