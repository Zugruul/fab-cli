---
tags: [git, permissions, process]
paths: []
strength: 1
source: "APP-001 rounds 1-2"
confidence: direct
graduated: false
created: 2026-08-01
last-touched: 2026-08-01
---

When history rewrite is needed but force-push is permission-denied: rebuild via cherry-picks in a DETACHED worktree (git worktree add --detach — a bare 'worktree add <dir> main' checks out and then ADVANCES local main) and push as a NEW branch + replacement PR, closing the old one with a pointer. Never route the denied push through another agent.
