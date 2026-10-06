---
tags: [review, git, diffs]
paths: ["pipeline/**", "fab-cli/**", "fab-app/**"]
strength: 1
source: "PR#248 APP-024 retro"
confidence: direct
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

Diff-source check: before reading any diff as 'this PR's changes', confirm it is a merge-base diff — gh pr diff, the PR file list, or git diff $(git merge-base main branch)..branch. A raw two-dot main..branch diff surfaces every file MAIN changed after the fork as if the branch touched it. Unrelated files in a two-dot diff = check merge-base first, not a scope-creep finding.

Related: [[diff-deferred-scope-against-primary-ac]]
