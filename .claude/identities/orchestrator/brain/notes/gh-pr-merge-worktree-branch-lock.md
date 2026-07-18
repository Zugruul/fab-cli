---
tags: [github, merge, worktree]
paths: ["**"]
strength: 2
source: "PR#96, PR#97 (FAB-021, FAB-022) merge attempts, same session"
graduated: false
created: 2026-07-18
---

'gh pr merge --squash --delete-branch' can print a local git error ('fatal: X is already used by worktree at Y') from its post-merge local-branch-cleanup step, even though the remote squash-merge fully succeeded — this happens when the orchestrator's working directory is a secondary worktree and the target branch (e.g. main) is checked out in another worktree, so gh's local switch-to-main step fails. Always verify with 'gh pr view <N> --json state,mergedAt,mergeCommit' before treating this error as a failed merge; recover locally via 'git checkout --detach origin/<branch>' rather than fighting for the branch ref. CONFIRMED RECURRING: hit identically on PR#96 and PR#97 in the same session — this is the expected/default outcome in this operating mode (secondary worktree + primary worktree holding main), not a one-off.

Related: [[gh-pr-merge-diverged-local]]
