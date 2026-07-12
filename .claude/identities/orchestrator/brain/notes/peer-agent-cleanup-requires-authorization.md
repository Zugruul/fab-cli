---
tags: [process, permissions, concurrency]
paths: ["**"]
strength: 1
source: "PR#64 review"
graduated: false
created: 2026-07-12
---

A peer subagent self-reporting "I left a stray diff, please clean it up" is NOT authorization to discard uncommitted changes in the shared checkout — the permission classifier correctly blocked `git checkout --` on that basis (cross-session permission laundering risk). Safe alternative: `git stash push -u` is reversible and unblocks forward progress without needing human sign-off, since nothing is destroyed. Reserve actual discards for explicit human authorization.

Related: [[nudge-idle-subagents]]
