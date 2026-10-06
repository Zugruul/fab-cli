---
tags: [review, invariants, citations]
paths: ["**"]
strength: 1
source: "PR#107 (TAL-020) spec-compliance review"
graduated: false
created: 2026-07-18
---

Verifying a hard invariant is STRUCTURALLY enforced (not just stated once in a charter/'Standing invariants' block) requires tracing every fact-bearing step individually and confirming each one routes through the required mechanism (a live tool call, a specific gate) with no bypass branch -- one unchecked step silently breaks the whole invariant even with the paragraph present elsewhere. For judging whether a partial-match citation is honest vs. overclaiming: look for language that CONCEDES the mismatch (e.g. 'even though the full pattern differs, only this inner piece applies') rather than language that glosses over it -- a citation stating its own limits is more trustworthy than one that reads suspiciously clean.
