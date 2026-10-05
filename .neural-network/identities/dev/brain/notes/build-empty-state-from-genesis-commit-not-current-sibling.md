---
tags: [brains, scaffolding, git]
paths: [".claude/identities/**"]
strength: 1
source: "PR#101 (TAL-012) dev retro"
graduated: false
created: 2026-07-18
---

When scaffolding a role's fresh/empty state (a new identity brain, a new config section) by analogy to an existing sibling, never infer the shape from the sibling's CURRENT files -- they've accumulated content since creation and no longer represent 'empty'. Trace git log --follow --diff-filter=A to the sibling's genesis commit, or read the tool's own source (e.g. brain.py's file-init logic) to get the TRUE fresh-scaffold shape before writing anything.
