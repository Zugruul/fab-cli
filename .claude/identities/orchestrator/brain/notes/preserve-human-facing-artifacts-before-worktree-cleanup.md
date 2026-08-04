---
tags: [worktree, cleanup, artifacts]
paths: [".claude/**"]
strength: 1
source: "#244 iteration feedback"
confidence: direct
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

Gitignored artifacts a lane generated FOR THE HUMAN (opened sample sheets, reports) must be regenerated in or copied to a persistent location BEFORE removing the lane's worktree — cleanup silently destroys what the human is still viewing. Happened on #244: the open sample sheet's images died with the worktree; regenerated in main checkout.
