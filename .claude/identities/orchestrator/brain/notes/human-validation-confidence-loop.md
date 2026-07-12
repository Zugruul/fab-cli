---
tags: [brains, validation, confidence, human-in-the-loop, cache]
paths: []
strength: 2
source: "loop-feedback 2026-07-11; extended loop-feedback 2026-07-12"
graduated: false
created: 2026-07-11
---

Cached derived answers (adjudications, analyses) should carry an explicit CONFIDENCE line and pass through a structured human check — and when a question hits an existing cached note, the answer flow is FAST-THEN-VERIFY: (1) answer immediately FROM the cache, clearly LABELED as a previously-adjudicated answer with its adjudication date + source-document version (stamping the cache with the source version makes staleness detection a trivial version compare and repeat consults instant); (2) announce and run a live re-verification of the underlying sources (text authority, document sections, official rulings) and report whether the cached answer still holds; (3) only then run the human check: AskUserQuestion WITH a preview of the answer's core line (so the human can annotate), options correct / incorrect / unsure. Wire each response to a state transition on the cached note: confirmed → stamp human-confirmed + date AND append to a running reaffirmation-timestamp trail, strength bumps, repeated confirmations become graduation candidates; disputed → mark do-not-answer-from-this and RE-DERIVE from the source documents — a human objection is a suggestion to investigate, never a direct edit (same one-way knowledge-flow rule as any non-authoritative source), and if re-research can't locate the error, ask the human why it's wrong before re-minting; unsure → pending-confirmation, research deeper and/or ask which part was unclear, seek an external authority, block graduation until resolved. This gives cached knowledge tiers (source-verified < human-confirmed < externally-confirmed) instead of a binary. Cf. [[recall-needs-structural-links]], [[lean-vs-briefed-identity-validation]], [[human-directive-vs-readonly-consult]].
