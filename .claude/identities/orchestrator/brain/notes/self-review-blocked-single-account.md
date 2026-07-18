---
tags: [github, merge, auto-merge]
paths: ["**"]
strength: 1
source: "PR#94 (FAB-020) merge attempt"
graduated: false
created: 2026-07-18
---

'gh pr review --approve' fails with 'Can not approve your own pull request' when the authenticated gh account owns both the PR and the repo (single-account setup, no separate bot/reviewer account) — this is expected, not a bug to work around. When merge requirements are 'none' (no branch protection), record the approval + review summary as a 'gh pr comment' instead, then proceed straight to 'gh pr merge'.

Related: []
