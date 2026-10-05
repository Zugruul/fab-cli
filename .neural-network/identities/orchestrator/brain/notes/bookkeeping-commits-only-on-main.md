---
tags: [git, concurrency, lanes]
paths: [".claude/**"]
strength: 1
source: "APP-026 iteration feedback"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

Orchestrator bookkeeping commits (brains, feedback, telemetry) happen ONLY with main checked out. Sequence retro/feedback BEFORE creating the next lane's branch, or switch back to main first. Incident: APP-026's retro commit landed on the next lane's just-created branch (shared working dir) and needed cherry-pick + branch-reset surgery while the lane's dev agent was live. Long-term fix: dedicated worktrees per lane.

Related: [[board-reads-are-a-budget]]
