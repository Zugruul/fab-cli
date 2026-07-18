---
tags: [git, concurrency, workflow]
paths: ["**"]
strength: 1
source: "PR#90/#91 (issue #7, FAB-012) — shared-checkout branch corruption incident"
graduated: false
created: 2026-07-18
---

`git switch main && git pull --ff-only` reporting "up to date" does NOT guarantee the NEXT `git switch -c <new-branch>` actually branches from that verified commit — if another concurrent session mutates the shared working directory's HEAD between those two commands (a real risk when multiple Claude Code sessions operate on the same repo clone), the new branch silently forks from whatever HEAD happened to be at that instant, potentially including another session's in-progress, unmerged commits. Caught in PR#90: a branch created this way was missing an entire merged epic (FAB-011's src/http.ts) and carried 4 unrelated commits from a concurrent TAL-001 session. The check that actually matters is AFTER branch creation: `git merge-base main <new-branch>` must equal `git rev-parse main` (or `origin/main`) — verify this immediately post-branch-creation, before spawning any dev agent onto it, not just once at the start of the iteration. If it doesn't match, the branch is corrupted; recover in an isolated worktree (`git worktree add`, cherry-pick the intended commits, push under a fresh name) rather than trying to fix it in the shared checkout.
Related: [[review-from-refs-in-isolated-worktree]]
