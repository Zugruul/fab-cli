---
tags: [review, tdd, verification]
paths: ["**"]
strength: 2
source: "PR#52 review round 1; reinforced PR#98 (TAL-011) code-quality review"
graduated: false
created: 2026-07-12
---

Strongest TDD verification: create an isolated worktree at the test-only commit and RUN the tests — they must fail red with the implementation file missing. Commit ordering in git log can be staged; a red run at the test commit cannot. Cheap (~30s) and conclusive; use it when the task's DoD claims red-first.

When a LATER commit in the same PR touches shared test-discovery config (e.g. `vitest.config.ts`), running the full `npm run gate` at the test-only commit is unsafe — that config fix hasn't landed at that SHA yet, so the run can fail/behave differently for reasons unrelated to the diff under test, masking whether the target test itself is genuinely red. Run the specific new test file directly (`npx vitest run <path>`) instead, independent of gate/config state.

Related: [[reproduce-gate-claims]]
