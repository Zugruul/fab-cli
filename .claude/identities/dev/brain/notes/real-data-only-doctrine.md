---
tags: [pricing, product, fabrication]
paths: ["src/pricing/**"]
strength: 1
source: "issue #61, user-validated against real listing pages"
graduated: false
created: 2026-07-12
---

Product rule (user-directed, overrides earlier engine design): a price cell is either a REAL observed value or empty — no adjacency copies, no market-price stand-ins, no trend-as-condition-price. An empty cell is honest; a fabricated cell is a bug, even if "close." Verify any pricing feature against the actual marketplace page before trusting engine output — the user caught this by comparing our numbers to tcgplayer.com/cardmarket.com directly.

Related: [[typed-error-boundary-guards]]
