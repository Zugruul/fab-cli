---
tags: [review, verification, git]
paths: ["**"]
strength: 1
source: "PR#111 (TAL-023) spec-compliance review"
graduated: false
created: 2026-07-18
---

To prove a negative claim like 'no PR exists anywhere referencing this branch', one query isn't enough -- check every distinct angle the claim could be violated from. For a fork/org-repo pair: gh pr list against the ORG repo filtered by the fork's head ref (org-repo-side view) AND gh pr list against the FORK repo itself filtered by the branch (fork-side view), plus a text search as a backstop in case a head-filter's exact syntax silently no-ops rather than erroring. Absence confirmed from only one angle does not rule out the others.
