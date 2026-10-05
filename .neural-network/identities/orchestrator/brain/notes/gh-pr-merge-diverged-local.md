---
tags: [git, github, merge]
paths: ["**"]
strength: 1
source: "PR#47 merge"
graduated: false
created: 2026-07-12
---

`gh pr merge --squash --delete-branch` can print `fatal: Not possible to fast-forward` and look failed while the REMOTE merge actually SUCCEEDED — the error is only the local post-merge branch switch on a diverged main, and that switch can also revert working-tree file state you had on the branch. Always verify with `gh pr view N --json state,mergeCommit` before retrying, then `git pull --rebase --autostash`.

Related: [[gate-ambient-contamination]]
