---
tags: [review, testing, rigor, enum]
paths: ["test/**"]
strength: 1
source: "PR#107 (TAL-020) code-quality review"
graduated: false
created: 2026-07-18
---

When a state-machine/gate function has N valid non-triggering input values (e.g. 5 statuses that should all return false from a resume-check), verify tests assert EACH one individually rather than accepting a single generic 'returns false for something else' case. A catch-all test can pass even if the implementation only special-cases one wrong value and accidentally triggers on the others -- read the test file fully and diff its cases against the implementation's actual branches, not just check 'are there tests'.
