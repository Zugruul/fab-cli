---
tags: [review, docs, duplication, quality]
paths: ["docs/**", ".claude/talishar/**"]
strength: 1
source: "PR#98 (TAL-011) spec-compliance review"
graduated: false
created: 2026-07-18
---

When reviewing a condensed/derivative doc against its source for near-verbatim duplication, check two things independently, not just skim-compare: (a) sentence-level phrasing overlap (near-identical clauses, even reordered, are a red flag) and (b) whether the new doc's section contains information/structure the source doesn't have at all (new lists, checklists, enumerations). High overlap on (a) with genuine net-new content on (b) is a quality nit worth fixing, not a blocker; a section that fails (b) entirely -- pure reorg, zero new value -- is the real red line that should block.
