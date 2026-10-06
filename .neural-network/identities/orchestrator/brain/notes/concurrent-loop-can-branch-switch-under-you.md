---
tags: [git, concurrency, autonomous-loop, uncommitted-work, incident]
paths: []
strength: 3
source: "development-skills neural-view session — concurrent build loop on same clone; reinforced PR#101 (TAL-012) — orchestrator committed onto a live subagent's branch"
graduated: false
created: 2026-07-11
---

Editing a shared plugin repo's main branch directly is risky when that SAME clone also runs its own autonomous build loop concurrently (branch switches, rebases, stash-before-pull hygiene). Several iterations of uncommitted neural-view work briefly disappeared from git status after the loop did pull --rebase + checkout to an unrelated task's branch on the same checkout. Nothing was actually destroyed — checking out back to main and pulling brought every change back — but it took real time to diagnose and looked exactly like data loss (git status showed a fully clean tree matching a stale branch). Compounded by [[background-session-cwd-resets-between-calls]] — the first git-status check that seemed to confirm loss was itself run against the wrong repo. Separately, the loop's own stash-before-pull hygiene bundled unrelated pre-existing dirty files together with one of my edits into a single stash, which could cause a confusing conflict if popped carelessly.

Why this matters: an uncommitted diff is only ever safe on the branch you last saw it on — a concurrent process switching branches on the SAME working tree can make it vanish from the CURRENT view (git status against whatever branch is checked out NOW), not because it's gone, but because you're looking at the wrong branch.

How to apply: when editing a repo known to run its own autonomous loop, commit each working increment immediately instead of batching multiple UI/code iterations uncommitted. Before trusting a git status/git diff read as authoritative (especially after a scare), check git branch --show-current and git reflog first.

The mistake also runs the OTHER direction: the orchestrator itself can forget it switched the shared checkout to a subagent's feature branch (to spawn that subagent) and then, later in the same session, run its OWN housekeeping commit (a retro note, a design-doc fix) without re-checking — landing orchestrator-owned content on the subagent's branch instead of mainBranch. `git branch --show-current` immediately before ANY orchestrator-authored commit is the cheap prevention; recovery after the fact needs an isolated worktree (to touch main without disturbing the subagent's live checkout) plus a targeted `git rebase --onto`/`--autostash` to extract the stray commit without losing the subagent's concurrent uncommitted work -- and may need repeating if the subagent already synced with the polluted branch before the fix landed.
