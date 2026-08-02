---
tags: [review, process, quality]
paths: []
strength: 1
source: "APP loop session 2026-08-01/02, ~24 PRs"
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

Brief every reviewer to REPRODUCE findings, not just read diffs — and independently re-verify the dev's headline claims (gate exit, red-commit purity) as orchestrator before routing to review. Across a long run this two-layer skepticism repeatedly caught what either layer alone missed: write-ordering data loss, state-machine wedges, cross-file store corruption, a license violation. Reviews that only read plausible code approve plausible bugs. Related: [[regate-second-merge-on-fresh-main]], [[inspect-lane-on-silent-idle]].
