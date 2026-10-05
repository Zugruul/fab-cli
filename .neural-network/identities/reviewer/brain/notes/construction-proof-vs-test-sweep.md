---
tags: [review, verification, proofs]
paths: ["pipeline/**", "fab-cli/**", "fab-app/**"]
strength: 1
source: "PR#254 #252 retro"
confidence: direct
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

Construction-proof vs test-sweep in review: use a construction-proof when the invariant is a STATIC syntactic relationship readable in one code path (clamped bounds = provable subset; monotone accumulator) — it covers the entire input domain at once. Switch to a mutation/test-sweep the moment the invariant depends on float magnitude, emergent multi-step state, or external data. Cheap tell: if defending the invariant needs value-tracing through >2 function calls, run the mutation — you are simulating the interpreter, not proving. When budget allows only one: the mutation (causal evidence beats inference).

Related: [[execute-load-bearing-mechanism-claims]] [[sweep-formula-domain-numerically]] [[mutation-test-monotonic-fixtures]]
