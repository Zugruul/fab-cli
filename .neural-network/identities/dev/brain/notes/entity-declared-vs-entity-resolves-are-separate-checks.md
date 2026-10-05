---
tags: [entities, brains, verification]
paths: [".claude/identities/**"]
strength: 1
source: "PR#102 (TAL-013) dev retro"
graduated: false
created: 2026-07-18
---

When a design doc conditions an action on something resolving ('declare entities: [card:<slug>] IF anchored to a real card'), treat 'declared' and 'resolves' as two SEPARATE checks -- don't stop at pattern-matching the slug format. Actually run the resolution check (entity-index anchor != null) before committing to a key. A multi-variant entity (e.g. a card with 3 pitch-color notes and no canonical singular anchor) can be genuinely ambiguous; the correct move is to drop the entity declaration and keep the reference in prose rather than force a broken anchor just to satisfy the pattern.
