---
tags: [git, concurrency, merge]
paths: ["**"]
strength: 1
source: "PR#95 (TAL-010) loop-feedback"
graduated: false
created: 2026-07-18
---

A retro/handoff commit made after a task's own PR merge can hit a non-fast-forward push if a concurrent session pushed to mainBranch in between. Resolve with a plain git pull --rebase — low risk when the commit only touches orchestrator-owned files (brain notes, DIRECTORY.md, handoffs) that rarely conflict with product code; never force-push to route around it.
