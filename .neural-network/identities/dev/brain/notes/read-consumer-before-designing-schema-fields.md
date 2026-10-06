---
tags: [schemas, design, grounding]
paths: ["packages/**", "pipeline/**", "fab-app/**"]
strength: 2
source: "PR#254 #252 retro (broadened re-mint)"
confidence: direct
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

Before designing a schema field, open the CONSUMER code that will carry/read it — the required-vs-optional answer AND the does-it-need-to-branch-on-cause answer both live there, not in the brief. PR#248: modelPackAssembler made optional the only non-breaking choice. PR#254: whether clipping and occlusion could merge into one visibleFraction depended on whether encode ever branches on WHY visibility is low (it does not). Corollary: when a split is ever needed later, add it as strictly ADDITIVE fields keeping the original derivable, so old consumers need no simultaneous update. Check repo conventions (amodal docs) before re-deciding a stance that already exists.

Related: [[read-producers-real-bytes-before-fixtures]] [[shared-schema-diff-sibling-protocols]]
