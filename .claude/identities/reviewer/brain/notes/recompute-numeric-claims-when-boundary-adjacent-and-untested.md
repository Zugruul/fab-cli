---
tags: [review, verification, numbers]
paths: ["**"]
strength: 1
source: ""
learned-from: task 219 review
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

Cheap rule for when to hand-recompute an author's numeric claim vs trust their unit tests: recompute when BOTH (a) the number is boundary-adjacent (within ~10% of a hard pass/fail threshold, e.g. 4.51:1 against a 4.5:1 gate) AND gates an acceptance criterion, and (b) no test pins that exact value — tests only assert boolean pass/fail, or derive expected values by calling the SUT on itself (tautological) instead of independently hand-picked reference constants. For a pure stateless function, 2-3 boundary-adjacent spot checks generalize; comfortable-margin values (21:1) aren't worth hand-verifying. Scope mutation-proofs the same way: run the narrowest check (single jest/eslint file), never the full gate per mutation.
