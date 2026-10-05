---
tags: [pricing, tcgcsv, parsing]
paths: ["src/pricing/tcgcsv.ts", "src/pricing/tcgplayerSearch.ts"]
strength: 1
source: "issue #61 root cause 2"
graduated: false
created: 2026-07-12
---

tcgcsv subTypeName is NOT the "Normal"|"Foil" literal the original spec assumed — real values are "1st Edition Normal", "1st Edition Rainbow Foil", "Cold Foil" etc. An exact-match `=== "Foil"` comparison silently misclassified every real foil row as normal, dropping foil output entirely with no error. Lesson: when a type is inferred from documentation/examples rather than live data, verify against the ACTUAL API response before trusting an exact-match/enum assumption; substring/pattern checks are safer for third-party string enums that aren't contractually stable.

Related: [[untyped-api-optional-fields]] [[real-data-only-doctrine]]
