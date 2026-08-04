---
tags: [delegation, efficiency]
paths: [".claude/**"]
strength: 1
source: "APP-036 iteration feedback"
confidence: direct
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

When a review round yields only small, exactly-prescribed edits on a task with no live dev agent, apply them directly with the dev identity attribution — spawning a context-less agent for trivial edits wastes a full context transfer. Reserve agent spawns for work needing independent implementation judgment. Applied on PR#245 (5 direct fix commits across 3 rounds of live debugging).
