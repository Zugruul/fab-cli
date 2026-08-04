---
tags: [git, rebase, concurrency, shared-fix, verification, worktrees]
paths: []
strength: 1
source: ""
confidence: direct
learned-from: task 257 iteration, 2026-08-04
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

# "Rebase onto main" is meaningless if the commit isn't pushed

A shared fix committed to the **local** main and not pushed makes every lane's
`git rebase origin/main` a silent no-op. Both sides read "up to date" as
success: the orchestrator believes the fix propagated, the dev believes it
already had it.

Observed: an entity-index fix was committed locally, a lane was told to rebase,
the rebase reported "Current branch is up to date", and the dev reasonably
concluded its branch already contained the change. It did not. Only an explicit
ancestry check surfaced it.

**Rules:**
1. After committing a shared fix, **push it** and confirm the remote ref
   actually moved (`git log --oneline origin/main -1`) before telling any lane
   to pick it up.
2. Verify with `git merge-base --is-ancestor <sha> HEAD`, never with the
   rebase's own "up to date" message — that message cannot distinguish
   "already have it" from "there was nothing to fetch".
3. Note the worktree subtlety: worktrees share an object database, so a local
   commit may be *reachable* without being an ancestor of the branch. That
   makes plausible-but-wrong "I already have it" reasoning easy.
