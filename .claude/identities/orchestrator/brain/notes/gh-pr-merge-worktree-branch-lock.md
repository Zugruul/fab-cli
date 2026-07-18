---
tags: [github, merge, worktree]
paths: ["**"]
strength: 1
source: "PR#96 (FAB-021) merge attempt"
graduated: false
created: 2026-07-18
---

'gh pr merge --squash --delete-branch' can print a local git error ('fatal: X is already used by worktree at Y') from its post-merge local-branch-cleanup step, even though the remote squash-merge fully succeeded — this happens when the orchestrator's working directory is a secondary worktree and the target branch (e.g. main) is checked out in another worktree, so gh's local switch-to-main step fails. Always verify with 'gh pr view <N> --json state,mergedAt,mergeCommit' before treating this error as a failed merge; recover locally via 'git checkout --detach origin/<branch>' rather than fighting for the branch ref.

Related: [[gh-pr-merge-diverged-local]]
