---
tags: [review, math, verification]
paths: ["pipeline/**"]
strength: 1
source: "PR#240 APP-028 retro"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

Numerically sweeping a formula's full input domain is the cheapest high-yield review tool for math code: pure Python, no deps, no checkout needed. PR#240 round 1: reading the ArcFace formula looked textbook-correct; plugging cosine near -1 exposed the margin reversal. Round 2: a 2001-point x 5-margin sweep proved the fix holds everywhere, not just at the pinned test value. Reading confirms plausible; sweeping confirms correct.

Related: [[prefix-swapback-verification]] [[execute-load-bearing-mechanism-claims]] [[reference-implementation-guard-diff]]
