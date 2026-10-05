---
tags: [review, git, verification]
paths: ["**"]
strength: 1
source: "PR#109 (TAL-021) spec-compliance review"
graduated: false
created: 2026-07-18
---

To verify a branch is genuinely based on a freshly-synced/current base ref (not a stale local ref), do not trust the PR body's narrative claim -- run git merge-base <branch> <base> and confirm it equals the base ref's current tip commit. This directly proves the branch was cut from the current base, with zero trust in the author's own account of what they synced.
