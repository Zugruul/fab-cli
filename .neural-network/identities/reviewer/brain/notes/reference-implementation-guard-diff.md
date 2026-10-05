---
tags: [review, algorithms, boundaries]
paths: ["pipeline/**"]
strength: 1
source: "PR#240 APP-028 retro"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

When a PR reimplements a named published algorithm with a canonical reference implementation, diff the PR's math against the REFERENCE'S edge-case guards specifically, not just its happy-path formula — a reimplementation that reproduces the formula but drops the guard is a distinct, checkable defect class. Verify numerically WHY the guard exists (sweep with and without it) rather than trusting its absence doesn't matter.

Related: [[sweep-formula-domain-numerically]]
