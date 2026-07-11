---
tags: [git, concurrency, autonomous-loop, uncommitted-work, incident]
paths: []
strength: 2
source: "development-skills neural-view session — concurrent build loop on same clone"
graduated: false
created: 2026-07-11
---

Editing a shared plugin repo's main branch directly is risky when that SAME clone also runs its own autonomous build loop concurrently (branch switches, rebases, stash-before-pull hygiene). Several iterations of uncommitted neural-view work briefly disappeared from git status after the loop did pull --rebase + checkout to an unrelated task's branch on the same checkout. Nothing was actually destroyed — checking out back to main and pulling brought every change back — but it took real time to diagnose and looked exactly like data loss (git status showed a fully clean tree matching a stale branch). Compounded by [[background-session-cwd-resets-between-calls]] — the first git-status check that seemed to confirm loss was itself run against the wrong repo. Separately, the loop's own stash-before-pull hygiene bundled unrelated pre-existing dirty files together with one of my edits into a single stash, which could cause a confusing conflict if popped carelessly.

Why this matters: an uncommitted diff is only ever safe on the branch you last saw it on — a concurrent process switching branches on the SAME working tree can make it vanish from the CURRENT view (git status against whatever branch is checked out NOW), not because it's gone, but because you're looking at the wrong branch.

How to apply: when editing a repo known to run its own autonomous loop, commit each working increment immediately instead of batching multiple UI/code iterations uncommitted. Before trusting a git status/git diff read as authoritative (especially after a scare), check git branch --show-current and git reflog first.
