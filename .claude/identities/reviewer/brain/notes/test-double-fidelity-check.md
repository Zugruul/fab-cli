---
tags: [review, testing, shims]
paths: ["test/**"]
strength: 1
source: "PR#89 review round 1 (TAL-001)"
graduated: false
created: 2026-07-18
---

Read fake/shim implementations line-by-line, not just the assertions, and ask: does this double replicate the real tool's FAILURE modes? A shim more permissive than the real tool (e.g. fake `git remote set-url` succeeding on a missing remote) silently masks a whole bug class the green suite will never catch. Flag fidelity gaps explicitly so they get documented or fixed.

Related: [[verify-red-commit-by-running-it]]
