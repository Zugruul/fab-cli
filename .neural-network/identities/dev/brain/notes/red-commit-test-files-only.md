---
tags: [tdd, hooks, commits]
paths: []
strength: 1
source: "APP-001 In-review hook block"
confidence: direct
graduated: false
created: 2026-08-01
last-touched: 2026-08-01
---

The red-first TDD hook requires the branch's FIRST commit to touch ONLY test files — even wiring the test runner into package.json must be a separate second commit, or the In-review move is blocked and history must be rebuilt. Structure commits as: 1) test file(s) only, 2) runner wiring, 3+) implementation.
