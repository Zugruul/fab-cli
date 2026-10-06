---
tags: [pricing, cache, testing]
paths: ["src/pricing/**", "test/pricing/**"]
strength: 1
source: "PR#47 PRICE-001"
graduated: false
created: 2026-07-12
---

cachedFetch contract (src/pricing/cache.ts): records are {fetchedAt, value}; corrupted/wrong-shape files self-heal by re-fetching; a fetcher error PROPAGATES even when a stale cache exists (never silently serve stale). Tests must pass a fs.mkdtemp dir (or FAB_PRICING_CACHE_DIR) — never touch real HOME. Keep every pricing client (tcgcsv, storefront, cardmarket, fx) consistent with this contract.

Related: [[scoped-green-verification]]
