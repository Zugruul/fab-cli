---
tags: [brains, migration, entities, testing]
paths: ["scripts/backfill-entities.py", "test/scripts/**", ".claude/identities/**"]
strength: 1
source: "PR#71 retro"
graduated: false
created: 2026-07-16
---

Metadata backfills must distinguish exact text matches from real aboutness: FAB card names collide with rules, token, protocol, and policy vocabulary. Use an explicit reviewed ambiguity mechanism, sample the applied corpus, and test negative domain collisions.
Migration reconciliation must restore rejected files byte-for-byte against the base; semantic removal can still leave whitespace residue. Count physically changed files as well as accepted records.
