---
tags: [brains, retro, mint, hygiene]
paths: [".claude/identities/**"]
strength: 1
source: "PR#95 (TAL-010) loop-feedback"
graduated: false
created: 2026-07-18
---

Before calling brain.py mint for a retro lesson, grep/recall the target role's existing notes for the same topic first — mint itself does not check for topical overlap (only prune catches stale LINKS, never duplicate CONTENT), so skipping this step lets near-duplicate notes accumulate silently. Caught once already (PR#95: verify-red-first-by-running-test-commit-not-trusting-pass-count duplicated the pre-existing verify-red-commit-by-running-it) only by browsing the notes directory before committing.
