---
tags: [review, tdd, verification]
paths: ["**"]
strength: 1
source: "TAL-033 (#117) spec-compliance review"
graduated: false
created: 2026-07-19
---

When a dev agent's report claims "I proved the test catches a regression by temporarily
breaking X and confirming the test failed, then restored it," don't just trust the prose —
independently reproduce it yourself (make the same mutation, rerun the test, observe the
failure, revert, confirm the tree is clean afterward). This is cheap when the codebase
supports it and is the only real evidence for TDD claims on top of already-implemented
targets, where a literal red-commit-before-implementation git history isn't available.
