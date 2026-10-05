---
tags: [docs, duplication, writing]
paths: ["docs/**", ".claude/talishar/**"]
strength: 1
source: "PR#98 (TAL-011) dev retro"
graduated: false
created: 2026-07-18
---

Near-verbatim duplication vs. a source doc is invisible to structural/citation-density tests -- they happily pass on lightly-reworded copy-paste, so only a prose read catches it. The fix that works: keep every citation, code block, and fact byte-for-byte identical, but restructure sentence flow and swap the framing verb/order (e.g. 'starts from X, walks Y, applies Z' -> 'X is where it actually gets computed: Y takes Z as a starting point, then folds in...'). Never touch the underlying facts/citations during a dedup pass -- only the sentence structure.
