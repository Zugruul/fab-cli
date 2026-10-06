---
tags: [git, worktree, submodules, npm]
paths: ["**"]
strength: 1
source: "PR#89 (TAL-001) dev retro"
graduated: false
created: 2026-07-18
---

In this repo `npm install` runs a postinstall that inits git submodules; a worktree that ran it can't be removed with plain `git worktree remove` ("working trees containing submodules cannot be moved or removed") — use `--force`. Applies to any worktree-based fix round here.
