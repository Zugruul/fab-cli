---
tags: [merge, parking, slots]
paths: ["**"]
strength: 1
source: ""
confidence: direct
learned-from: task 221
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

When a review-approved task parks at In review on a human/external gate and main keeps moving, PRE-STAGE its merge while waiting: rebase the branch onto current main in a detached scratch worktree, run the full gate on the rebased tree, force-push with lease, and note it on the issue. A clean rebase preserves the recorded approval (content unchanged — no re-review), and the resume path shrinks to exactly the gated atom (#221: only the live smoke remained when the box came up; merge landed minutes later). Also makes the merge-freshness rule a non-event instead of resume-time work.
