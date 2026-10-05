---
tags: [concurrency, subagents, workflow]
paths: ["**"]
strength: 1
source: "PR#50 iteration"
graduated: false
created: 2026-07-12
---

Spawned dev/reviewer agents sometimes go idle mid-task (idle_notification with committed-but-unpushed work, no PR, no report). Check ground truth (git log on their branch, git status of their paths) instead of assuming completion or failure, then SendMessage a nudge listing the exact remaining steps (commit pending edit, gate, record, push, PR, report). One nudge recovered the lane in <2 min on PR#50.

Related: [[gate-ambient-contamination]]
