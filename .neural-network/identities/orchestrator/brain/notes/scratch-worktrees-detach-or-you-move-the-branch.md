---
tags: [git, worktree, branch-surgery]
paths: ["**"]
strength: 1
source: ""
learned-from: task 217
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

`git worktree add <path> <branch>` CHECKS OUT that branch in the worktree — commits made there (cherry-picks, rebases) move the real branch ref. During #217's history reorder, `git worktree add tmp main` + cherry-picks silently advanced local `main` onto the feature commits, which then broke the red-first board-move hook ("branch has no test commit" — because main..branch had shrunk to 3 commits) and needed `git branch -f main origin/main` to repair. For any scratch/surgery worktree, use `git worktree add --detach <path> <ref>` so HEAD is detached and no branch can move; and remove the worktree in its own command (a compound command that gets hook-blocked can silently skip the cleanup step, leaving the worktree pinning the branch).
