---
tags: [docs, spec-delta, review, claims]
paths: ["**"]
strength: 1
source: ""
learned-from: task 218 round-1 finding
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

The only review finding on #218: the PR body claimed "the spec delta notes the design-doc gate-contract extension" but the committed delta file contained no such note — the claim described intent, not the artifact. Every claim a PR body makes about a file must be verifiable IN that file as committed (grep it before pushing); and whenever a task extends a contract that the epic design doc records (gate contract, interfaces, data models), the spec delta must carry an explicit "Design-doc note" naming the stale line and the exact text to append, so the orchestrator folds the design doc together with the spec at merge — otherwise the binding design doc silently goes stale.
