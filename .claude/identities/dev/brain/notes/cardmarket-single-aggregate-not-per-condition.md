---
tags: [pricing, cardmarket, product]
paths: ["src/pricing/cardmarket.ts"]
strength: 1
source: "issue #67"
graduated: false
created: 2026-07-12
---

Cardmarket's price guide has exactly ONE real price signal (`low`) — not four. Fanning one number into multiple UI columns implies data that doesn't exist, even if each fanned cell is individually a "real" (non-fabricated) number. This is a subtler violation of real-data-only-doctrine than outright fabrication: the number is real, but its presentation implies false precision/granularity. Watch for this pattern elsewhere — one source value rendered into N semantically-distinct columns needs each column's own justification, not just "the number itself is real."

Related: [[real-data-only-doctrine]]
