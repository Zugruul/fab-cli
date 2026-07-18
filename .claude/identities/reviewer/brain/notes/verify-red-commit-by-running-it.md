---
tags: [review, tdd]
paths: ["test/**"]
strength: 1
source: "PR#89 review rounds 1-2 (TAL-001)"
graduated: false
created: 2026-07-18
---

Never trust a "red first" commit message: check out the test commit in isolation and run the suite there — genuine red shows the specific new tests failing against the unmodified implementation. Also confirms the fix commit turns exactly those red tests green.

Related: [[test-double-fidelity-check]]
