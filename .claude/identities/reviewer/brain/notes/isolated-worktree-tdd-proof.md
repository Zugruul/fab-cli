---
tags: [review, tdd, verification]
paths: ["**"]
strength: 1
source: "PR#52 review round 1"
graduated: false
created: 2026-07-12
---

Strongest TDD verification: create an isolated worktree at the test-only commit and RUN the tests — they must fail red with the implementation file missing. Commit ordering in git log can be staged; a red run at the test commit cannot. Cheap (~30s) and conclusive; use it when the task's DoD claims red-first.

Related: [[reproduce-gate-claims]]
