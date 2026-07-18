---
tags: [concurrency, merge, board]
paths: ["**"]
strength: 1
source: "issue #99 — PR #100 superseded by PR #98's bundled fix"
graduated: false
created: 2026-07-18
---

Two concurrent sessions in the same multi-agent repo independently picked up and fixed the SAME small, obvious bug (a missing vitest exclude pattern) within the same session window — one via a dedicated task/PR, another as unplanned scope-creep bundled into an unrelated PR. Neither noticed until review time, when the second PR's branch turned out stale/conflicting against the first's already-merged fix. For small, high-visibility infra bugs (config files, gate tooling) that any concurrent session might independently notice and fix, check 'git log origin/main -- <the file>' for very recent unrelated commits BEFORE spawning a dev agent, not just at review/merge time — board.sh's WIP-limit and epic-sequencing don't protect against two DIFFERENT sessions racing the same ad-hoc bug fix, since it isn't epic-sequenced work.

Related: [[gh-pr-merge-worktree-branch-lock]]
