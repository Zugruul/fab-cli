---
tags: [review, generated-diff, entities, tdd]
paths: ["scripts/**", "test/scripts/**", ".claude/identities/**"]
strength: 1
source: "PR#71 review rounds 1-3"
graduated: false
created: 2026-07-16
---

For generated metadata migrations, exact string matching is not proof of aboutness. Review the applied corpus across collision classes, compare rejected files byte-for-byte to base, and reconcile semantic yield with the physical changed-file count.
Large generated PRs can exceed GitHub diff APIs; review from the local commit range and keep isolated red-worktree execution as hard TDD evidence.
