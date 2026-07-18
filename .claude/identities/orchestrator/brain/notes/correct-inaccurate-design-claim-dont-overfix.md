---
tags: [docs, review]
paths: ["docs/design/**"]
strength: 1
source: "PR#96 (FAB-021) review round 1"
graduated: false
created: 2026-07-18
---

When a reviewer flags a design-doc claim as inaccurate ('X mirrors Y's behavior' but Y has no such behavior), the cheapest fix is usually correcting the doc to state the truth plainly rather than defending or backporting to make the claim retroactively true — unless the inconsistency itself is the actual problem. On FAB-021, 'rules show mirrors lore show's ambiguous-match handling' was simply false (lore show has none); the honest fix was rewording the doc, with a backport into lore show noted as an optional future improvement, not a blocking requirement.

Related: []
