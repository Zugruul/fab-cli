---
tags: [review, testing, fix-rounds]
paths: ["test/**"]
strength: 1
source: "PR#113 (TAL-024) code-quality review"
graduated: false
created: 2026-07-19
---

When re-reviewing a fix for a round-1 blocking finding, don't just check the commit message's claim or that the test now passes -- diff what actually changed in the test's ASSERTIONS specifically. Confirm the toMatch/toBe/etc. calls still target the identical real strings/paths/function-names as round 1, and that the only thing that moved is the SOURCE of the value under test (e.g. file read -> in-memory fixture), not the specificity of what's being checked. A fix can silently satisfy 'tests now pass' by loosening what's asserted rather than fixing the actual coupling problem -- verify it fixed the coupling, not just made the red go away.
