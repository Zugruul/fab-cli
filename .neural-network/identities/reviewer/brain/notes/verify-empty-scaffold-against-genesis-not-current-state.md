---
tags: [review, brains, scaffolding, git]
paths: [".claude/identities/**"]
strength: 1
source: "PR#101 (TAL-012) spec-compliance review"
graduated: false
created: 2026-07-18
---

When verifying a PR's claim that a scaffold/init file 'matches house layout' or an 'empty-state shape', diff against the sibling instance's GENESIS commit (git log --follow --diff-filter=A -- <path> | tail -1), never its current, content-accumulated state -- otherwise correct empty scaffolding gets flagged as a false negative for looking 'too bare' compared to a mature file.
