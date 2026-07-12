---
tags: [pricing, cardmarket, matching]
paths: ["src/pricing/**", "data/**"]
strength: 1
source: "PR#54 live run"
graduated: false
created: 2026-07-12
---

Cardmarket splits the same physical set across multiple idExpansion values (per-language catalog entries sharing English card names) — e.g. 4477/4479 both 442 products, same sample names. This makes many card names non-unique and is WHY only 42/116 idExpansions get anchor votes; the exclusion is correct conservative behavior. Missing set names are an overrides/matching concern (cm-expansion-<id> rows), not an algorithm bug — don't "fix" the anchorer.

Related: [[tcgcsv-requires-user-agent]]
