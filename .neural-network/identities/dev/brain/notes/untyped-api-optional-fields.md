---
tags: [pricing, http, parsing, testing]
paths: ["src/pricing/**", "test/fixtures/pricing/**"]
strength: 1
source: "PR#52 review round 1"
graduated: false
created: 2026-07-12
---

Third-party JSON APIs omit keys instead of sending empty arrays/nulls — every field access on a raw upstream shape needs a guard (`p.listings ?? []`) and the TYPE should mark it optional. Fixtures must include a missing-key case (key absent entirely), not just an empty-value case — `[]` fixtures alone gave false confidence on PR#52's primary zero-listings path.

Related: [[provider-prefixed-raw-types]] [[pricing-cache-contract]]
