---
tags: [persistence, consistency, testing]
paths: []
strength: 1
source: "BUG-180 PR#205 review"
confidence: direct
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

When records are keyed by an ID that can appear in MULTIPLE sibling stores (accepted/rejected files, state-partitioned outputs), any supersede/dedupe operation must span every store the ID can live in — per-file dedupe leaves a conflicting stale record in the sibling when the verdict/partition flips. Fix at the write layer (append removes the ID from siblings) and test through the REAL persistence wiring, not just the in-memory runner: unit tests that skip the production callback never see this class of bug.
