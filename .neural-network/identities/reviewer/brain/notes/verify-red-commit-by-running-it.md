---
tags: [review, tdd]
paths: ["test/**"]
strength: 2
source: "PR#89 review rounds 1-2 (TAL-001); reinforced PR#95 (TAL-010) code-quality review"
graduated: false
created: 2026-07-18
---

Never trust a "red first" commit message: check out the test commit in isolation and run the suite there — genuine red shows the specific new tests failing against the unmodified implementation. Also confirms the fix commit turns exactly those red tests green.

File-level pass/fail counts aren't enough: a test file can look rigorous while containing at least one vacuous assertion (e.g. `expect(true).toBe(true)`) that would never fail even before the real implementation existed. Check per-assertion outcomes at the red commit, not just "N/M files failed" — PR#95 had 19/20 assertions genuinely fail and 1 pass trivially throughout, invisible from the aggregate.

Related: a fresh isolated worktree can itself produce unrelated-looking red (uninitialized submodules, missing node_modules) — before reporting any failure as PR-caused, reproduce it against `main` in the same isolated worktree to separate "the PR broke this" from "my worktree setup is incomplete."

Related: [[test-double-fidelity-check]]
