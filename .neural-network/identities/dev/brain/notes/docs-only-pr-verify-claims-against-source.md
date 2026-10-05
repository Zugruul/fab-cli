---
tags: [docs, verification, review]
paths: ["CLAUDE.md", "README.md", "docs/**"]
strength: 1
source: "PR#93 (TAL-003) dev retro"
graduated: false
created: 2026-07-18
---

For docs-only PRs describing existing automation (scripts/skills/CLI flags), build a claim inventory from the diff — flag names, exact string literals (log-line prefixes, exit codes), invariant citations — then verify each against the actual source at time of writing, not memory or paraphrase. Treat the script/skill file as the spec and the doc prose as a claim to be checked, not the other way around. String literals like `synced:`/`diverged:` prefixes are highest-value checks since they typo/drift easily and are unambiguous to grep-verify.
