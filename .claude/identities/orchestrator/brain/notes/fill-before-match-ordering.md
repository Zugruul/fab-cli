---
tags: [pricing, design, sequencing]
paths: ["src/pricing/**", "docs/design/**"]
strength: 1
source: "PR#56 review"
graduated: false
created: 2026-07-12
---

Engine ordering contract (from PR#56 review): per-provider condition FILL (live listings + market fallback, §8.2) must run BEFORE buildComparisonRows — the matcher's no-price exclusion fires on whatever cells it sees, so a listing-less TCGplayer row with a valid tcgcsv marketPrice would be mis-reported no-price if matched pre-fill. Command wiring (PRICE-012/021) assembles: fetch → fill per provider → match → ratio.

Related: [[spec-delta-for-approved-deviations]]
