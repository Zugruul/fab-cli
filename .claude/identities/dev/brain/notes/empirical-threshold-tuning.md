---
tags: [pricing, anchoring, calibration]
paths: ["src/pricing/**"]
strength: 1
source: "issue #60"
graduated: false
created: 2026-07-12
---

When asked to add a confidence/plausibility threshold, don't just implement the orchestrator's suggested number — run it against the live dataset first. The suggested 1.5x would have wiped out ~15 correct high-confidence mappings (legit sets cluster 1.4x-2.0x); the empirically-derived 2.5x cleanly separates legit (max 1.98x) from bad (5.6x+) with zero false positives/negatives observed. State the deviation clearly (commit message, code comment, PR body) rather than silently picking a different number.

Related: [[real-data-only-doctrine]]
