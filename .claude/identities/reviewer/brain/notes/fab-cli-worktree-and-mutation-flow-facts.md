---
tags: [fab-cli, worktree, pnpm, mutation-testing]
paths: ["**"]
strength: 1
source: ""
learned-from: task 218 review
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

Repo-specific review-flow facts for fab-cli: (a) `git worktree add --detach <path> origin/<branch>` + `pnpm install --frozen-lockfile` at the MONOREPO ROOT is sufficient for fab-app gate reproduction — pnpm hoists to root node_modules, no nested install needed. (b) When mutation-testing a check, restore with `git checkout -- <file>`, never `$$`-keyed temp backups — each Bash tool call is a fresh subshell with a different PID, so `$$`-based filenames silently mismatch across calls and the restore fails quietly; verify with `git status --short` before reporting regardless. (c) Always leave the worktree removed and verify via `git worktree list`.
