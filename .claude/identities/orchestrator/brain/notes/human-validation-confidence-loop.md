---
tags: [brains, validation, confidence, human-in-the-loop]
paths: []
strength: 1
source: "loop-feedback 2026-07-11"
graduated: false
created: 2026-07-11
---

Cached derived answers (adjudications, analyses) should carry an explicit CONFIDENCE line and pass through a structured human check: after relaying the answer, ask correct / not correct / unsure (AskUserQuestion, three options). Wire each response to a state transition on the cached note: confirmed → stamp human-confirmed + date, strength bumps, repeated confirmations become graduation candidates; disputed → mark do-not-answer-from-this and RE-DERIVE from the source documents — a human objection is a suggestion to investigate, never a direct edit (same one-way knowledge-flow rule as any non-authoritative source); unsure → pending-confirmation, seek an external authority, block graduation until resolved. This gives cached knowledge tiers (source-verified < human-confirmed < externally-confirmed) instead of a binary. Cf. [[recall-needs-structural-links]], [[lean-vs-briefed-identity-validation]].
