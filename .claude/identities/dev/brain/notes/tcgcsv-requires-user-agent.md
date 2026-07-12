---
tags: [pricing, http, tcgcsv]
paths: ["src/pricing/tcgcsv.ts", "scripts/**"]
strength: 1
source: "PR#54"
graduated: false
created: 2026-07-12
---

tcgcsv.com 401s Node's default fetch (no User-Agent) but 200s any browser-ish UA — a permanent upstream trait, verified twice independently. Current workaround: inject UA via the tcgcsv client's fetchFn override (done in scripts/cardmarket-expansions.ts). PRICE-021 export will hit this; reviewer recommendation on record (issue note): default the UA inside src/pricing/tcgcsv.ts itself.

Related: [[sibling-pattern-parity]]
