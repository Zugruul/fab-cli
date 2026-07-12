---
tags: [review, data-verification]
paths: ["src/pricing/**"]
strength: 1
source: "PR#63 review"
graduated: false
created: 2026-07-12
---

When a PR justifies a magic number (ratio, threshold) with "I checked the live data," don't just read the claimed numbers — recompute at least one or two yourself from the actual data/API before approving. On PR#63 this confirmed the dev's 2.5x ratio claims were real, not cherry-picked. Cheap to do, catches fabricated justifications.

Related: [[reproduce-gate-claims]]
