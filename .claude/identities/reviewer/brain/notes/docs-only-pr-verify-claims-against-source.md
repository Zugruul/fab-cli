---
tags: [docs, verification, review]
paths: ["CLAUDE.md", "README.md", "docs/**"]
strength: 1
source: "PR#93 (TAL-003) reviewer retro"
graduated: false
created: 2026-07-18
---

When reviewing a docs-only diff describing existing automation, build a claim inventory (flag names, exact string literals, exit codes, invariant IDs) and verify each against the real source — don't rubber-stamp prose that 'sounds right'. String literals (log-line prefixes) are the highest-value checks since they're easy to typo/drift and unambiguous to grep-verify. Also: spec section numbers (e.g. §10 I3) shift as documents grow, so a citation should be re-verified rather than assumed permanent if the spec is later restructured.
