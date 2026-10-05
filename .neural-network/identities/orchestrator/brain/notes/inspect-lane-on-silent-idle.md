---
tags: [agents, process, concurrency]
paths: []
strength: 1
source: "APP-031 lost-report incident"
confidence: direct
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

When a subagent goes idle without delivering its completion report, inspect the lane directly before assuming failure or re-messaging: check branch commits (git log origin/main..HEAD), staged/working state, and PR existence — the work is frequently complete with only the report message lost to the idle race. Resume the agent only when the lane shows genuinely unfinished work.
