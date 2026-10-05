---
tags: [board, config, pattern]
paths: []
strength: 1
source: "loop-feedback 2026-07-10"
graduated: false
created: 2026-07-10
---

Treat the GitHub board as a projection of project.yaml plus an idempotent seeder. This absorbed aggressive mid-setup churn (epics reordered to change build order, priorities flipped, tasks retitled, tasks closed as deferred) with zero board surgery: edit config, re-run seeder/board commands, and next-task immediately honors the new sequencing. Gotcha: some board helpers want the ISSUE NUMBER not the task id (prio), and comment can fail — fall back to gh issue comment when board.sh comment rejects a non-empty body.
