---
tags: [review, brains, verification, wikilinks]
paths: [".claude/identities/**"]
strength: 1
source: "PR#102 (TAL-013) code-quality review"
graduated: false
created: 2026-07-18
---

For a large batch of interlinked knowledge notes (10+ files with [[wikilinks]] and entities: declarations), spot-checking 5-6 by eye is necessary but not sufficient for a 'links are clean' claim. Write a one-line script checking that EVERY wikilink across ALL files resolves to a real note filename, and every declared entity resolves to a non-null anchor -- this is what makes a 'no broken references' verdict trustworthy rather than assumed from a sample.
