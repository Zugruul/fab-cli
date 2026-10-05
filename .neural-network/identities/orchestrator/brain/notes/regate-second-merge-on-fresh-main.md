---
tags: [merge, concurrency, gate]
paths: []
strength: 1
source: "PR#187 x PR#188 integration break"
confidence: direct
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

When two PRs from parallel lanes are merge-ready, the SECOND must be re-validated against post-first-merge main BEFORE merging — two individually-green PRs can break the combined tree (e.g. one adds a required type field, the other's new fixtures predate it; textual auto-merge succeeds, typecheck fails). Serial merge dance means: merge one, sync main, merge main into (or rebase-check) the second lane, re-gate, THEN merge the second. Catching it after both merged means a hotfix on main under a red gate.
