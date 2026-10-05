---
tags: [review, mutation-testing, invariants]
paths: ["pipeline/**"]
strength: 1
source: "PR#241 APP-085 retro"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

Mutation-test a suite when (a) it claims a property over an id space with an implicit total order AND (b) the fixtures are monotonic relative to that order — that shape makes broken and correct impls output-identical. Trigger words: 'property-tested', 'append-only', 'never remapped', 'never fabricated' — claims verifiable only by breaking, not reading. Cost calculus: pure function + data-corruption-class invariant = always worth one mutation + rerun; display/formatting logic = skip.

Related: [[execute-load-bearing-mechanism-claims]] [[prefix-swapback-verification]]
