---
tags: [review, testing, qa]
paths: ["pipeline/**"]
strength: 1
source: "PR#240 APP-028 retro"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

If a test's stability required trying multiple configs/seeds before one passed, the failures are DATA, not noise: require an explicit, tracked decision (issue comment, QA leg, backlog line) about whether they represent a known limitation — never let the negative result live only in a docstring or commit message. PR#240: 2/32 swept configs broke float/int8 ranking agreement; good-faith disclosure in the docstring, but it took review pressure to get it onto the issue as a QA leg.

Related: [[compute-edge-frequency-from-config]] [[diff-deferred-scope-against-primary-ac]]
