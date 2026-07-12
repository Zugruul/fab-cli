---
tags: [pricing, types, naming]
paths: ["src/pricing/**"]
strength: 1
source: "PR#50 review round 1"
graduated: false
created: 2026-07-12
---

Raw upstream API row types get provider-prefixed names (TcgcsvPriceRow, not PriceRow) — the bare domain names (PriceRow, ConditionPrices, PriceProvider) belong to src/pricing/types.ts. Every provider module (tcgplayer, cardmarket, fx) imports BOTH its raw shapes and the domain shapes, so a shared name forces import aliasing everywhere downstream. Prefix at creation time.

Related: [[pricing-cache-contract]]
