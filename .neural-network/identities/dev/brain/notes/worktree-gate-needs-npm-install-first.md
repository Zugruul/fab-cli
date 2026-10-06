---
tags: [worktree, gate, npm]
paths: ["**"]
strength: 1
source: "PR#92 (TAL-002) dev retro"
graduated: false
created: 2026-07-18
---

A fresh git worktree has no node_modules — `npm run gate` (tsc/eslint/prettier) fails until `npm install` runs there first. Budget that step before the first gate attempt in any new worktree.
